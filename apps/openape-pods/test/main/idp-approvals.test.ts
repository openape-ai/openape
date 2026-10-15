// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { typesafeOrigin } from '../../src/contracts/jev'
import { httpArgv, runtimeArgv } from '../../src/main/grants/pod-permissions'
import { httpSpec, runtimeSpec } from '../../src/main/grants/pod-grants'
import { applicationId, brokerRejections, closeProfiles, deniedPodId, identityProvider, issuer, podId, program, workerFixture } from './idp-fixture'

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

it('opens a Pod execution identity without requesting a broad runtime grant', async () => {
  const f = await fixture()
  const run = f.start(podId, randomUUID(), 'manual')
  const context = await run.run
  expect(context).toMatchObject({ home: '/fixture/home', machine: { targetHost: `pods:${podId}` } })
  expect(idp.state.creates).toEqual([])
  expect(idp.state.tokens).toEqual([])
  expect(f.approvals).toEqual([])
  await run.call('shellClose')
})
