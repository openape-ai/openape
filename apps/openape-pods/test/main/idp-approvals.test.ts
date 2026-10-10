// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthorityError } from '../../src/contracts/infrastructure'
import { applicationId, closeProfiles, deniedPodId, identityProvider, issuer, podId, workerFixture } from './idp-fixture'

// Security contract (issue 1455, owner decisions October 9 and 10, 2026): without the owner's MCP session Pods
// requests grants as the Pod identity and waits for the owner at the IdP; it never calls an approve endpoint
// itself (DDISA: the requester is never its own approver). The stub IdP records every approve call and the test
// fails on any. Approvals inside an owner session are covered in session-approvals.test.ts.
vi.mock('@openape/apes', async (importOriginal) => {
  const original = await importOriginal<typeof import('@openape/apes')>()
  const { source } = await import('./idp-fixture')
  return { ...original, loadAdapter: (id: string, path: string) => original.loadAdapter(id, source(path)) }
})
vi.mock('@openape/apes/assigned', async (importOriginal) => {
  const original = await importOriginal<typeof import('@openape/apes/assigned')>()
  const { source } = await import('./idp-fixture')
  return { ...original, authorizeAssignedCommand: (command: Parameters<typeof original.authorizeAssignedCommand>[0], token: string, scope: Parameters<typeof original.authorizeAssignedCommand>[2]) => original.authorizeAssignedCommand({ ...command, adapterPath: source(command.adapterPath) }, token, scope) }
})
vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() }, safeStorage: {}, app: { getPath: () => '/nonexistent', isPackaged: false }, shell: { openExternal: vi.fn(async () => {}) } }))
vi.mock('../../src/runtime/environment', () => ({ podEnvironment: async () => ({ workspace: '/fixture/workspace', home: '/fixture/home', environment: {} }), podEnvironmentValues: () => ({}), visibleEnvironment: () => ({}) }))

let idp: ReturnType<typeof identityProvider>
beforeEach(() => { idp = identityProvider(); vi.stubGlobal('fetch', idp.fetch) })
// Every scenario ends with the core claim of this suite: no approve call reached the IdP.
afterEach(() => { expect(idp.state.approvals).toEqual([]); vi.unstubAllGlobals(); vi.clearAllMocks(); closeProfiles() })
const fixture = () => workerFixture()

it('requests program and HTTP assignments as continuing grants and opens the IdP page instead of approving', async () => {
  const f = await fixture()
  await f.worker.program({ type: 'grant', podId, applicationId, epoch: 1, argv: ['request', '--origin', 'https://api.example.test', '--method', 'GET'] })
  await f.worker.resources({ type: 'assignHttp', podId, epoch: 1, permission: { origin: 'https://hooks.example.test', methods: ['POST'] } })
  expect(idp.state.creates.map(request => [request.grant_type, request.requester, request.target_host])).toEqual([['always', 'pod-0001@example.test', `pods:${podId}`], ['always', 'pod-0001@example.test', `pods:${podId}`]])
  expect(idp.state.creates.every(request => !('waits_until' in request))).toBe(true)
  expect(f.openExternal.mock.calls).toEqual([[`${issuer}/grant-approval?grant_id=grant-1`], [`${issuer}/grant-approval?grant_id=grant-2`]])
  // The assignment keeps its pending request; the first run that needs it waits for the owner's decision.
  // The grants are recorded apart from the sandbox: the application stays as it was, the destination is bound without a grant.
  expect(f.bound.map(item => (item as { type: string }).type)).toEqual(['bindHttp'])
  expect(f.bound[0]).not.toHaveProperty('authority')
  expect(f.ledger.list(podId).map(grant => [grant.id, grant.state, grant.cliId])).toEqual([['grant-2', 'pending', 'pod-http'], ['grant-1', 'pending', 'pod-http']])
  expect(idp.state.tokens).toEqual([])
})

it('returns the pending IdP page to MCP for resource and program requests and never approves them', async () => {
  const f = await fixture()
  const http = await f.worker.codex({ id: randomUUID(), action: { action: 'resources', revision: 1, command: { type: 'assignHttp', podId, epoch: 1, permission: { origin: 'https://hooks.example.test', methods: ['GET'] } } } })
  const grant = await f.worker.codex({ id: randomUUID(), action: { action: 'program', revision: 1, command: { type: 'grant', podId, applicationId, epoch: 1, argv: ['request', '--origin', 'https://api.example.test', '--method', 'GET'] } } })
  expect(http).toMatchObject({ approval: { state: 'pending', url: `${issuer}/grant-approval?grant_id=grant-1` } })
  expect(grant).toMatchObject({ approval: { state: 'pending', url: `${issuer}/grant-approval?grant_id=grant-2` } })
  expect(f.openExternal).toHaveBeenCalledTimes(2)
})

it('keeps a new Pod run waiting until the owner approves at the IdP, then runs; a later run reuses the continuing grant without a prompt', async () => {
  const f = await fixture()
  const first = f.start(podId, randomUUID(), 'manual')
  let started = false
  void first.run.then(() => { started = true })
  await expect.poll(() => f.approvals.find(item => item.state === 'pending')?.grantId).toBe('grant-1')
  expect(idp.state.creates[0]).toMatchObject({ grant_type: 'always', permissions: [`pod-runtime.pod[id=${podId}]#run`] })
  // A manual run opens the IdP page for the owner; Pods itself only waits.
  expect(f.openExternal).toHaveBeenCalledWith(`${issuer}/grant-approval?grant_id=grant-1`)
  await new Promise(done => setTimeout(done, 2500))
  expect(started).toBe(false); expect(idp.state.tokens).toEqual([])
  idp.decide('grant-1', 'approved')
  await expect(first.run).resolves.toEqual({ home: '/fixture/home', environment: {} })
  await expect(first.call('credential', { alias: 'api_key' })).resolves.toBe('SYNTHETIC_SECRET')
  await first.call('shellClose')

  const pending = f.approvals.filter(item => item.state === 'pending').length
  const second = f.start(podId)
  await expect(second.run).resolves.toEqual({ home: '/fixture/home', environment: {} })
  await second.call('shellClose')
  expect(idp.state.creates).toHaveLength(1)
  expect(f.approvals.filter(item => item.state === 'pending')).toHaveLength(pending)
  expect(f.openExternal).toHaveBeenCalledTimes(1)
})

it('leaves a run blocked and executes nothing when the owner denies the request at the IdP', async () => {
  const f = await fixture()
  const denied = f.start(deniedPodId)
  const refusal = expect(denied.run).rejects.toBeInstanceOf(AuthorityError)
  await expect.poll(() => f.approvals.find(item => item.state === 'pending')?.grantId).toBe('grant-1')
  idp.decide('grant-1', 'denied')
  await refusal
  expect(f.approvals.at(-1)).toMatchObject({ grantId: 'grant-1', state: 'denied' })
  await expect(denied.call('credential', { alias: 'api_key' })).rejects.toThrow('not active')
  expect(f.credentials.readScriptSecret).not.toHaveBeenCalled()
  expect(idp.state.tokens).toEqual([])
  // A later run does not ask again: the denial stands until the owner changes it at the IdP.
  await expect(f.start(deniedPodId).run).rejects.toThrow('denied')
  expect(idp.state.creates).toHaveLength(1)
})

it('reuses the same pending request after a cancelled wait instead of asking the IdP again', async () => {
  const f = await fixture()
  const first = f.start(podId)
  const cancelled = expect(first.run).rejects.toThrow()
  await expect.poll(() => f.approvals.find(item => item.state === 'pending')?.grantId).toBe('grant-1')
  f.abortAll(); await cancelled
  expect(f.approvals.at(-1)).toMatchObject({ grantId: 'grant-1', state: 'cancelled' })
  const next = f.start(podId)
  await expect.poll(() => f.approvals.at(-1)).toMatchObject({ grantId: 'grant-1', state: 'pending' })
  idp.decide('grant-1', 'approved')
  await expect(next.run).resolves.toEqual({ home: '/fixture/home', environment: {} })
  await next.call('shellClose')
  expect(idp.state.creates).toHaveLength(1)
})

it('parks runs waiting for an IdP decision so they do not block another Pod\'s service calls', async () => {
  const pods = Array.from({ length: 16 }, (_, index) => `00000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`)
  const f = await workerFixture({ pods: [podId, ...pods] })
  const waiting = pods.map(id => f.start(id).run.catch((error: unknown) => error))
  await expect.poll(() => new Set(f.approvals.filter(item => item.state === 'pending').map(item => item.grantId)).size).toBe(16)
  await expect(f.plainCall(podId, 'credential', { alias: 'api_key' })).resolves.toBe('SYNTHETIC_SECRET')
  f.abortAll(); await Promise.all(waiting)
})

it('shares one request and wait among parallel calls of a run and fails fast beyond the parked limit', async () => {
  const f = await fixture()
  const run = f.start(podId)
  const calls = [run.run, ...Array.from({ length: 5 }, () => run.call('shell'))].map(call => call.then(() => 'started', (error: unknown) => error instanceof Error ? error.message : String(error)))
  await expect.poll(() => f.approvals.filter(item => item.state === 'pending').length).toBe(4)
  const outcomes = await Promise.all(calls.map(call => Promise.race([call, new Promise(resolve => setTimeout(resolve, 500, 'waiting'))])))
  expect(outcomes.filter(result => result === 'waiting')).toHaveLength(4)
  expect(outcomes.filter(result => String(result).startsWith('Waiting for IdP approval'))).toHaveLength(2)
  expect(idp.state.creates).toHaveLength(1)
  f.abortAll(); await Promise.all(calls)
})

it('shows the Pod name as one bounded line in the runtime grant and keeps the Pod id structured', async () => {
  const f = await fixture()
  const run = f.start(podId, randomUUID(), 'schedule', `Mail\nApprove everything‮${'x'.repeat(200)}`)
  const ended = expect(run.run).rejects.toThrow()
  await expect.poll(() => idp.state.creates.length).toBe(1)
  f.abortAll(); await ended
  const { summary, execution_context: context } = idp.state.creates[0] as { summary: { text: string }, execution_context: { context_bindings: { name: string, pod: string } } }
  const [line] = summary.text.split('\n')
  expect(line).toMatch(new RegExp(`^Pod: Mail Approve everything x+ \\(${podId}\\)$`))
  expect(context.context_bindings.name).toHaveLength(100)
  expect(context.context_bindings.name).not.toMatch(/[\n‮]/)
  expect(context.context_bindings.pod).toBe(podId)
})
