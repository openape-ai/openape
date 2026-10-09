// @vitest-environment node
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthorityError } from '../../src/contracts/infrastructure'
import type { RunApproval } from '../../src/contracts/activity'
import type { ServiceRequest } from '../../src/contracts/services'

// Security contract (issue 1455, owner decision October 9, 2026): approvals stay at the IdP. Pods requests
// grants as the Pod identity and waits for the owner; it never calls an approve endpoint itself (DDISA: the
// requester is never its own approver). The stub IdP records every approve call and the test fails on any.
const sources = resolve('runtime-sources')
// The worker resolves its bundled adapters under dist/vendor; this suite reads the same reviewed sources.
const source = (path: string) => path.includes('/vendor/') ? resolve(sources, basename(path)) : path
vi.mock('@openape/apes', async (importOriginal) => {
  const original = await importOriginal<typeof import('@openape/apes')>()
  return { ...original, loadAdapter: (id: string, path: string) => original.loadAdapter(id, source(path)) }
})
vi.mock('@openape/apes/assigned', async (importOriginal) => {
  const original = await importOriginal<typeof import('@openape/apes/assigned')>()
  return { ...original, authorizeAssignedCommand: (command: Parameters<typeof original.authorizeAssignedCommand>[0], token: string, scope: Parameters<typeof original.authorizeAssignedCommand>[2]) => original.authorizeAssignedCommand({ ...command, adapterPath: source(command.adapterPath) }, token, scope) }
})
vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() }, safeStorage: {}, app: { getPath: () => '/nonexistent', isPackaged: false }, shell: { openExternal: vi.fn(async () => {}) } }))
vi.mock('../../src/runtime/environment', () => ({ podEnvironment: async () => ({ workspace: '/fixture/workspace', home: '/fixture/home', environment: {} }), podEnvironmentValues: () => ({}), visibleEnvironment: () => ({}) }))

const issuer = 'https://id.example.test'
const owner = 'owner@example.test'
interface StubGrant { status: string, request: Record<string, unknown> }

/** A synthetic IdP: grants start pending and change only through decide(), as when the owner decides there. */
function identityProvider() {
  const keys = generateKeyPairSync('ed25519')
  const grants = new Map<string, StubGrant>()
  const state = { approvals: [] as string[], tokens: [] as string[], creates: [] as Record<string, unknown>[] }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.origin !== issuer) throw new Error(`Unexpected network request to ${url.origin}`)
    if (url.pathname.includes('/approve')) { state.approvals.push(url.pathname); return json({ title: 'Pods must not approve' }, 500) }
    if (url.pathname === '/.well-known/jwks.json') return json({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'key', alg: 'EdDSA', use: 'sig' }] })
    if (url.pathname.startsWith('/api/pods/agents/')) return json({ email: decodeURIComponent(url.pathname.split('/')[4]!), owner, active: true, keyIds: ['key'], grantId: url.searchParams.get('grant'), grantActive: true })
    if (url.pathname === '/api/grants' && init?.method === 'POST') {
      const request = JSON.parse(String(init.body)) as Record<string, unknown>
      const id = `grant-${grants.size + 1}`
      state.creates.push(request); grants.set(id, { status: 'pending', request })
      return json({ id, status: 'pending' })
    }
    const [, , , id, action] = url.pathname.split('/')
    const grant = grants.get(id ?? '')
    if (!grant) return json({ title: 'Unknown grant' }, 404)
    if (action === 'token') {
      if (grant.status !== 'approved') return json({ type: 'https://openape.org/errors/grant_not_approved' }, 400)
      state.tokens.push(id!)
      const now = Math.floor(Date.now() / 1000)
      const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'key' })).toString('base64url')
      const payload = Buffer.from(JSON.stringify({ iss: issuer, sub: grant.request.requester, aud: 'shapes', target_host: grant.request.target_host, grant_id: id, grant_type: grant.request.grant_type, iat: now, exp: now + 3600, jti: randomUUID(), authorization_details: grant.request.authorization_details, execution_context: grant.request.execution_context })).toString('base64url')
      return json({ authz_jwt: `${head}.${payload}.${sign(null, Buffer.from(`${head}.${payload}`), keys.privateKey).toString('base64url')}` })
    }
    if (action === 'consume') return json({ status: 'valid' })
    if (action === undefined && (init?.method ?? 'GET') === 'GET') return json({ id, status: grant.status, request: grant.request })
    return json({ title: 'Unsupported' }, 404)
  })
  const decide = (id: string, status: 'approved' | 'denied') => { grants.get(id)!.status = status }
  return { state, fetch, decide }
}

const podId = '00000000-0000-4000-8000-000000000001'
const deniedPodId = '00000000-0000-4000-8000-000000000002'
const applicationId = '00000000-0000-4000-8000-0000000000a1'
const adapterPath = resolve(sources, 'pod-http-shapes.toml')
const program = { id: applicationId, podId, revision: 1, kind: 'tool', state: 'ready', name: 'Fixture CLI', configuration: { type: 'program', cliId: 'pod-http', adapterPath, adapterHash: createHash('sha256').update(readFileSync(adapterPath)).digest('hex'), capability: 'tool.app_fixture.invoke', grants: [] } }
let idp: ReturnType<typeof identityProvider>
beforeEach(() => { idp = identityProvider(); vi.stubGlobal('fetch', idp.fetch) })
// Every scenario ends with the core claim of this suite: no approve call reached the IdP.
afterEach(() => { expect(idp.state.approvals).toEqual([]); vi.unstubAllGlobals(); vi.clearAllMocks() })

async function fixture() {
  const { FixtureWorker } = await import('../../src/main/worker')
  const { ConnectionManager } = await import('../../src/main/connections/manager')
  const { ProgramManager } = await import('../../src/main/programs/manager')
  const { shell } = await import('electron')
  const worker = new FixtureWorker(() => {})
  const connection = (id: string) => ({ issuer, subject: `pod-${id.slice(-1)}@example.test`, owner, keyId: 'key', targetHost: `pods:${id}`, accessToken: async () => 'SYNTHETIC_POD_AGENT', identity: { podId: id, connectionId: randomUUID(), issuer, owner, subject: `pod-${id.slice(-1)}@example.test`, keyId: 'key' }, ownerConnection: 'owner-connection' })
  // The real ConnectionManager.request runs; only the provisioned Pod identity is synthetic.
  const connections = Object.assign(Object.create(ConnectionManager.prototype), { podConnection: async (id: string) => connection(id) })
  const approvals: RunApproval[] = []; const bound: Record<string, unknown>[] = []
  const receipts = new Map<string, unknown>()
  const reasons = new Map<string, string>()
  const resources = () => ({ epoch: 1, resources: [program], variables: [] })
  const dispatch = vi.fn(async (command: Record<string, any>) => {
    if (command.resource?.type?.startsWith('bind')) bound.push(command.resource)
    if (command.program?.type === 'save') bound.push(command.program)
    if (command.serviceCheck?.approval) approvals.push(command.serviceCheck.approval)
    if (command.runContext?.grant) return [...approvals].reverse().find(item => item.permission === command.runContext.grant.permission && item.subject === command.runContext.grant.subject && !['cancelled', 'expired'].includes(item.state)) ?? null
    if (command.runContext) return { name: 'Synthetic Pod', reason: reasons.get(command.runContext.scope.runId) ?? 'schedule', runtime: true }
    if (command.credentialCheck) return 'secret-id'
    if (command.codexAdministration) {
      const { type, request, result } = command.codexAdministration
      if (type === 'complete') receipts.set(request.id, result)
      return receipts.has(request.id) ? { completed: true, result: receipts.get(request.id) } : { completed: false }
    }
    return resources()
  })
  const credentials = { readScriptSecret: vi.fn(async () => 'SYNTHETIC_SECRET') }
  Object.assign(worker, { root: '/fixture', connections, credentials, dispatch })
  Object.assign(worker, { programs: new ProgramManager('/fixture/authentication', '/fixture/helper', credentials as never, connections, async () => resources() as never, command => dispatch({ program: command })) })
  const service = worker as unknown as { executeService: (request: ServiceRequest) => Promise<unknown> }
  const start = (id: string, runId = randomUUID(), reason = 'schedule') => {
    reasons.set(runId, reason)
    const scope = { podId: id, runId, epoch: 1, assignmentRevision: 1, capabilities: [] }
    const call = (kind: ServiceRequest['kind'], body: unknown = {}) => service.executeService({ id: randomUUID(), kind, scope, body })
    return { runId, run: call('shell'), call }
  }
  return { worker, approvals, bound, credentials, start, openExternal: vi.mocked(shell.openExternal) }
}

it('requests program and HTTP assignments as continuing grants and opens the IdP page instead of approving', async () => {
  const f = await fixture()
  await f.worker.program({ type: 'grant', podId, applicationId, epoch: 1, argv: ['request', '--origin', 'https://api.example.test', '--method', 'GET'] })
  await f.worker.resources({ type: 'assignHttp', podId, epoch: 1, permission: { origin: 'https://hooks.example.test', methods: ['POST'] } })
  expect(idp.state.creates.map(request => [request.grant_type, request.requester, request.target_host])).toEqual([['always', 'pod-1@example.test', `pods:${podId}`], ['always', 'pod-1@example.test', `pods:${podId}`]])
  expect(idp.state.creates.every(request => !('waits_until' in request))).toBe(true)
  expect(f.openExternal.mock.calls).toEqual([[`${issuer}/grant-approval?grant_id=grant-1`], [`${issuer}/grant-approval?grant_id=grant-2`]])
  // The assignment keeps its pending request; the first run that needs it waits for the owner's decision.
  expect(f.bound.map(item => (item as { type: string }).type)).toEqual(['save', 'bindHttp'])
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
