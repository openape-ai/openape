// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthorityError } from '../../src/contracts/infrastructure'
import { typesafeOrigin } from '../../src/contracts/jev'
import { httpArgv, runtimeArgv } from '../../src/main/grants/pod-permissions'
import { httpSpec, runtimeSpec } from '../../src/main/grants/pod-grants'
import { applicationId, brokerRejections, closeProfiles, deniedPodId, identityProvider, issuer, podId, podSubject, program, workerFixture } from './idp-fixture'

// Security contract (issue 1455, owner decisions October 9 and 10, 2026): without the owner's MCP session Pods
// requests grants as the Pod identity and waits for the owner at the IdP; it never calls an approve endpoint
// itself (DDISA: the requester is never its own approver). The stub IdP records every approve call and the test
// fails on any. Approvals inside an owner session are covered in session-approvals.test.ts.
vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() }, safeStorage: {}, app: { getPath: () => '/nonexistent', isPackaged: false }, shell: { openExternal: vi.fn(async () => {}) } }))
vi.mock('../../src/runtime/environment', () => ({ podEnvironment: async () => ({ workspace: '/fixture/workspace', home: '/fixture/home', environment: {} }), podEnvironmentValues: () => ({}), visibleEnvironment: () => ({}) }))

let idp: ReturnType<typeof identityProvider>
beforeEach(() => { idp = identityProvider(); vi.stubGlobal('fetch', idp.fetch) })
// Every scenario ends with the core claim of this suite: no approve call reached the IdP.
afterEach(async () => { expect(idp.state.approvals).toEqual([]); expect(await brokerRejections(idp.state.creates)).toEqual([]); vi.unstubAllGlobals(); vi.clearAllMocks(); closeProfiles() })
const fixture = () => workerFixture()

it('requests program and HTTP assignments as continuing grants and opens the IdP page instead of approving', async () => {
  const f = await fixture()
  await f.worker.program({ type: 'grant', podId, applicationId, epoch: 1, argv: ['request', '--origin', 'https://api.example.test', '--method', 'GET'] })
  await f.worker.resources({ type: 'assignHttp', podId, epoch: 1, permission: { origin: 'https://hooks.example.test', methods: ['POST'] } })
  // The program command is asked at the IdP with its program hash and exact argv (issue 1473, revision 4); the HTTP
  // destination is a desktop-own permission grant.
  expect(idp.state.authorizations).toEqual([{ target_host: `pods:${podId}`, audience: 'shapes', program: { name: 'fixture-cli', sha256: program.configuration.executableHash }, argv: ['request', '--origin', 'https://api.example.test', '--method', 'GET'], grant_type: 'always', summary: { title: 'fixture-cli request --origin https://api.example.test --method GET', origin: 'Pod 0001' } }])
  expect(idp.state.creates.map(request => [request.grant_type, request.requester, request.target_host])).toEqual([['always', 'pod-0001@example.test', `pods:${podId}`]])
  expect(idp.state.creates.every(request => !('waits_until' in request))).toBe(true)
  expect(f.openExternal.mock.calls).toEqual([[`${issuer}/grant-approval?grant_id=grant-1`], [`${issuer}/grant-approval?grant_id=grant-2`]])
  // The assignment keeps its pending request; the first run that needs it waits for the owner's decision.
  // The grants are recorded apart from the sandbox: the application stays as it was, the destination is bound without a grant.
  expect(f.bound.map(item => (item as { type: string }).type)).toEqual(['bindHttp'])
  expect(f.bound[0]).not.toHaveProperty('authority')
  expect(f.ledger.list(podId).map(grant => [grant.id, grant.state, grant.cliId])).toEqual([['grant-2', 'pending', 'pod-http'], ['grant-1', 'pending', 'fixture-cli']])
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
  // Another Pod's run gets its runtime decided and uses its services while the 16 runs stay parked.
  const other = f.start(podId)
  await expect.poll(() => f.approvals.filter(item => item.state === 'pending').length).toBe(17)
  idp.decide('grant-17', 'approved')
  await expect(other.run).resolves.toEqual({ home: '/fixture/home', environment: {} })
  await expect(other.call('credential', { alias: 'api_key' })).resolves.toBe('SYNTHETIC_SECRET')
  await other.call('shellClose')
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
  const { summary, command } = idp.state.creates[0] as { summary: { title: string, origin: string }, command: string[] }
  // Issue 1473: the IdP gets the permission's description as a title and the Pod's name as origin, each one bounded line.
  expect(Object.keys(summary).sort()).toEqual(['origin', 'title'])
  expect(summary.origin).toMatch(/^Mail Approve everything x+$/)
  expect(summary.origin).toHaveLength(100)
  expect(summary.title.length).toBeLessThanOrEqual(120)
  expect(summary.title).not.toMatch(/[\n‮]/)
  const value = (flag: string) => command[command.indexOf(flag) + 1]!
  expect(value('--name')).toHaveLength(100)
  expect(value('--name')).not.toMatch(/[\n‮]/)
  expect(value('--pod')).toBe(podId)
})

// Issue 1455 rehearsal: schema 43 removed the grant ids kept inside the resources and the brokered IdP never returns an
// existing grant for a new request. The runs' approval events still name every grant a Pod used; Pods adopts them.
function previousRun(f: Awaited<ReturnType<typeof fixture>>, events: { grantId: string, permission: string, state: string, subject?: string }[]) {
  const runId = randomUUID(); const at = Date.now() - 3600000
  f.store.db.prepare('INSERT INTO runs(id,pod_id,script_hash,state,started_at,finished_at,summary,error,checkpoint_revision,assignment_revision) VALUES(?,?,?,?,?,?,?,?,?,?)').run(runId, podId, 'hash', 'completed', at, at + 1000, '', null, 0, 1)
  events.forEach((event, index) => f.store.db.prepare('INSERT INTO run_events VALUES(?,?,?,?,?)').run(runId, index + 1, 'approval', JSON.stringify({ grantId: event.grantId, issuer, title: 'Earlier grant', permission: event.permission, subject: event.subject ?? podSubject(podId), state: event.state }), at + index))
}

it('adopts the grants a Pod used before schema 43 instead of asking the owner again', async () => {
  const f = await fixture()
  const runtime = runtimeSpec(podId, 'Synthetic Pod')
  const http = httpSpec('https://hooks.example.test', ['POST'])
  const target = { requester: podSubject(podId), target_host: `pods:${podId}` }
  const runtimeGrant = idp.foreign({ ...target, authorization_details: runtime.details, command: runtime.command }); idp.decide(runtimeGrant, 'approved')
  const httpGrant = idp.foreign({ ...target, authorization_details: http.details, command: http.command }); idp.decide(httpGrant, 'approved')
  // Skipped without failing the run: another target, a grant the IdP no longer shows, a single-use grant and another identity.
  const otherTarget = idp.foreign({ ...target, target_host: 'pods:another', authorization_details: runtime.details, command: runtime.command }); idp.decide(otherTarget, 'approved')
  const single = idp.foreign({ ...target, grant_type: 'once', authorization_details: runtime.details, command: runtime.command }); idp.decide(single, 'approved')
  previousRun(f, [
    { grantId: runtimeGrant, permission: runtime.details[0]!.permission, state: 'approved' },
    { grantId: httpGrant, permission: http.details[0]!.permission, state: 'approved' },
    { grantId: otherTarget, permission: runtime.details[0]!.permission, state: 'approved' },
    { grantId: 'grant-404', permission: runtime.details[0]!.permission, state: 'approved' },
    { grantId: single, permission: runtime.details[0]!.permission, state: 'approved' },
    { grantId: 'grant-foreign', permission: runtime.details[0]!.permission, state: 'approved', subject: 'pod-other@example.test' },
  ])
  const run = f.start(podId)
  await expect(run.run).resolves.toEqual({ home: '/fixture/home', environment: {} })
  await run.call('shellClose')
  await f.worker.resources({ type: 'assignHttp', podId, epoch: 1, permission: { origin: 'https://hooks.example.test', methods: ['POST'] } })
  expect(idp.state.creates).toEqual([])
  expect(f.openExternal).not.toHaveBeenCalled()
  expect(f.ledger.list(podId).map(grant => [grant.id, grant.state, grant.grantType]).sort()).toEqual([[runtimeGrant, 'approved', 'always'], [httpGrant, 'approved', 'always']].sort())
  expect(idp.state.tokens).toEqual([runtimeGrant])
  // Recorded once, a later run finds it in the ledger without reading the earlier events again.
  const next = f.start(podId)
  await expect(next.run).resolves.toEqual({ home: '/fixture/home', environment: {} })
  await next.call('shellClose')
  expect(idp.state.creates).toEqual([])
})

it('waits on an earlier pending request instead of asking again', async () => {
  const f = await fixture()
  const runtime = runtimeSpec(podId, 'Synthetic Pod')
  const pending = idp.foreign({ requester: podSubject(podId), target_host: `pods:${podId}`, authorization_details: runtime.details, command: runtime.command })
  previousRun(f, [{ grantId: pending, permission: runtime.details[0]!.permission, state: 'pending' }])
  const run = f.start(podId)
  await expect.poll(() => f.approvals.find(item => item.state === 'pending')?.grantId).toBe(pending)
  idp.decide(pending, 'approved')
  await expect(run.run).resolves.toEqual({ home: '/fixture/home', environment: {} })
  await run.call('shellClose')
  expect(idp.state.creates).toEqual([])
})

it('requests every desktop-own grant kind as a plain permission the owner IdP accepts for a Pod identity', async () => {
  const f = await fixture()
  const specs = {
    runtime: runtimeSpec(podId, 'Synthetic Pod'),
    oneMethod: httpSpec('https://hooks.example.test', ['POST']),
    methods: httpSpec('https://hooks.example.test', ['GET', 'POST']),
    origin: httpSpec('https://hooks.example.test'),
    jev: httpSpec(typesafeOrigin, ['POST']),
  }
  for (const spec of Object.values(specs)) await f.grants.request(podId, spec, AbortSignal.timeout(5000))
  expect(idp.state.creates).toHaveLength(5)
  expect(await brokerRejections(idp.state.creates)).toEqual([])
  // A single command carries the argv the IdP shows it with; a grant over several commands names only the permission's command.
  expect(idp.state.creates.map(request => request.command)).toEqual([runtimeArgv({ podId, name: 'Synthetic Pod', script: 'run.mjs', workspace: 'workspace' }), httpArgv('https://hooks.example.test', 'POST'), ['pod-http'], ['pod-http'], httpArgv(typesafeOrigin, 'POST')])
  // No adapter file, resolver or adapter digest is involved (issue 1473, revision 4).
  expect(idp.state.creates.every(request => !('execution_context' in request))).toBe(true)
})

it('opens the IdP page of a pending Pod grant for the owner and reads pending grants again until the IdP decided them', async () => {
  const f = await fixture()
  await f.worker.resources({ type: 'assignHttp', podId, epoch: 1, permission: { origin: 'https://hooks.example.test', methods: ['POST'] } })
  await f.worker.resources({ type: 'assignHttp', podId: deniedPodId, epoch: 1, permission: { origin: 'https://hooks.example.test', methods: ['GET'] } })
  // Entscheidungen opens the page only for a grant that this Pod requested and that still waits.
  await expect(f.grants.approvalPage(podId, 'grant-1')).resolves.toBe(`${issuer}/grant-approval?grant_id=grant-1`)
  await expect(f.grants.approvalPage(podId, 'grant-2')).rejects.toThrow('This grant no longer waits for your decision; refresh the view')
  // The owner decides on the IdP page; only the refresh tells the ledger, never an approve call of Pods.
  idp.decide('grant-1', 'approved'); idp.decide('grant-2', 'expired')
  await f.grants.refreshPending(AbortSignal.timeout(5000))
  expect([...f.ledger.list(podId), ...f.ledger.list(deniedPodId)].map(grant => [grant.id, grant.state])).toEqual([['grant-1', 'approved'], ['grant-2', 'expired']])
  await expect(f.grants.approvalPage(podId, 'grant-1')).rejects.toThrow('This grant no longer waits for your decision; refresh the view')
})
