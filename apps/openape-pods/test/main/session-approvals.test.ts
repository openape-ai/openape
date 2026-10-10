// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OwnerSession } from '../../src/main/connections/owner-session'
import { invokeProgram } from '../../src/main/programs/invoke'
import { prepareProgramAuthorization, resolveProgram } from '../../src/main/programs/session'
import { programWrite } from '../../src/worker/runs/program-effects'
import { PodGroups } from '../../src/worker/workspace/groups'
import type { ProgramAssignment } from '../../src/contracts/programs'
import { closeProfiles, deniedPodId, identityProvider, issuer, owner, ownerToken, podId, podSubject, program, workerFixture } from './idp-fixture'

// Owner decisions October 10, 2026 (issue 1455): the MCP session acts with the owner's identity, so grants a Pod
// requests can be approved in that session without the human. Outside an active owner session no code path
// approves, the persisted setup login is never used for it, and a decision only reaches own-Pod grants.
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
let root = ''
beforeEach(() => { idp = identityProvider(); vi.stubGlobal('fetch', idp.fetch); root = mkdtempSync(join(tmpdir(), 'pods-session-approvals-')) })
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); closeProfiles(); rmSync(root, { recursive: true, force: true }) })

/** The owner identity of one MCP session; its clock is the test's, and its tokens never leave this object. */
function session(clock = { now: Date.now() }) {
  const tokens = { issuer, account: owner, subject: owner, accessToken: ownerToken, refreshToken: 'SESSION_REFRESH', expiresAt: Math.floor(clock.now / 1000) + 3600 }
  return new OwnerSession(tokens, clock.now + 3600000, { refresh: async () => { throw new Error('No renewal expected') }, revoke: async (current) => { await fetch(`${issuer}/revoke`, { method: 'POST', body: JSON.stringify({ token: current.refreshToken }) }) } }, () => clock.now)
}
const mcp = (f: Awaited<ReturnType<typeof workerFixture>>, action: Record<string, unknown>, ownerSession: OwnerSession | null) => f.worker.codex({ id: randomUUID(), action }, ownerSession)
const httpGrant = (approve?: boolean) => ({ action: 'grants', command: { type: 'request', target: { podId }, grants: { http: [{ origin: 'https://hooks.example.test', methods: ['POST'] }] }, ...(approve === undefined ? {} : { approve }) } })

it('without an owner session every approve path throws or only requests, and the IdP sees no approve call', async () => {
  const f = await workerFixture()
  const requested = await mcp(f, httpGrant(true), null) as { outcomes: { grantId: string, state: string, approval?: string }[] }
  expect(requested.outcomes).toEqual([expect.objectContaining({ grantId: 'grant-1', state: 'pending', approval: `${issuer}/grant-approval?grant_id=grant-1` })])
  await expect(mcp(f, { action: 'grants', command: { type: 'approve', podId, grantId: 'grant-1' } }, null)).rejects.toThrow('active owner session')
  await expect(mcp(f, { action: 'grants', command: { type: 'deny', podId, grantId: 'grant-1' } }, null)).rejects.toThrow('active owner session')
  await expect(f.grants.approve(null, podId, 'grant-1', 'always', AbortSignal.timeout(1000))).rejects.toThrow('active owner session')
  // Desktop assignments and program grants without a session open the IdP page instead.
  await f.worker.resources({ type: 'assignHttp', podId, epoch: 1, permission: { origin: 'https://api.example.test', methods: ['GET'] } })
  expect(idp.state.decisions).toEqual([])
  expect(f.ledger.list(podId).map(grant => grant.state)).toEqual(['pending', 'pending'])
})

it('in an owner session requests and approves as always with the owner token, once, and marks the approval', async () => {
  const f = await workerFixture(); const owner = session()
  const first = await mcp(f, httpGrant(), owner) as { outcomes: { grantId: string, state: string, approvedInSession: boolean }[] }
  expect(first.outcomes).toEqual([expect.objectContaining({ grantId: 'grant-1', state: 'approved', approvedInSession: true })])
  expect(idp.state.creates[0]).toMatchObject({ requester: podSubject(podId), target_host: `pods:${podId}`, grant_type: 'always' })
  expect(idp.state.decisions).toEqual([{ action: 'approve', id: 'grant-1', bearer: ownerToken, body: { grant_type: 'always' } }])
  // A retry of the same declaration reuses the approved grant: no second request, no second decision.
  await mcp(f, httpGrant(), owner)
  expect(idp.state.creates).toHaveLength(1); expect(idp.state.decisions).toHaveLength(1)
  const listed = await mcp(f, { action: 'grants', command: { type: 'list', podId } }, owner) as { grants: { id: string, state: string, approvedInSession: boolean }[] }
  expect(listed.grants).toEqual([expect.objectContaining({ id: 'grant-1', state: 'approved', approvedInSession: true })])
})

it('refuses grants of a foreign requester or target and leaves them to the IdP', async () => {
  const f = await workerFixture(); const owner = session()
  const stranger = idp.foreign({ requester: 'stranger@example.test', target_host: `pods:${podId}` })
  const elsewhere = idp.foreign({ requester: podSubject(podId), target_host: `pods:${deniedPodId}` })
  const otherPod = idp.foreign({ requester: podSubject(deniedPodId), target_host: `pods:${deniedPodId}` })
  for (const grantId of [stranger, elsewhere, otherPod]) await expect(mcp(f, { action: 'grants', command: { type: 'approve', podId, grantId } }, owner)).rejects.toThrow('not requested by this Pod')
  expect(idp.state.decisions).toEqual([])
})

it('after the session ends approvals fail, pending grants keep waiting and the session token is revoked', async () => {
  const f = await workerFixture(); const clock = { now: Date.now() }; const owner = session(clock)
  await mcp(f, httpGrant(false), owner)
  clock.now += 3600000
  await expect(mcp(f, { action: 'grants', command: { type: 'approve', podId, grantId: 'grant-1' } }, owner)).rejects.toThrow('owner session ended')
  expect(idp.state.decisions).toEqual([])
  expect(f.ledger.list(podId)[0]).toMatchObject({ id: 'grant-1', state: 'pending' })
  await vi.waitFor(() => expect(idp.state.revokedTokens).toEqual(['SESSION_REFRESH']))
})

it('approves a waiting runtime grant in the session so the run continues without the human', async () => {
  const f = await workerFixture(); const owner = session()
  const run = f.start(podId)
  await expect.poll(() => f.approvals.find(item => item.state === 'pending')?.grantId).toBe('grant-1')
  const decision = await mcp(f, { action: 'grants', command: { type: 'approve', podId, grantId: 'grant-1' } }, owner)
  expect(decision).toMatchObject({ id: 'grant-1', state: 'approved', approvedInSession: true })
  await expect(run.run).resolves.toEqual({ home: '/fixture/home', environment: {} })
  await run.call('shellClose')
  expect(idp.state.decisions).toEqual([{ action: 'approve', id: 'grant-1', bearer: ownerToken, body: { grant_type: 'always' } }])
})

it('fans a network sandbox and its grants out to every member with the network as origin', async () => {
  const f = await workerFixture(); const owner = session(); const networkId = randomUUID()
  Object.assign(f.worker, { networks: async () => ({ networks: [{ id: networkId, revision: 3, state: 'paused', podIds: [podId, deniedPodId] }] }) })
  // The ledger counts a network's sandbox level only for the stored network at its current revision.
  const groups = new PodGroups(f.store); groups.execute({ type: 'organize', action: 'create', name: 'Synthetic company', revision: groups.view().revision })
  f.store.db.prepare('INSERT INTO network_owners VALUES(?,?)').run(issuer, 'network-owner')
  f.store.transaction(() => {
    f.store.db.prepare('INSERT INTO networks(id,owner_issuer,owner_subject,group_id,name,revision,restore_nonce,created_at) VALUES(?,?,?,?,?,3,?,?)').run(networkId, issuer, 'network-owner', groups.view().groups.at(-1)!.id, 'Synthetic network', randomUUID(), Date.now())
    f.store.db.prepare('INSERT INTO network_revisions VALUES(?,3,\'{}\',?,?)').run(networkId, 'a'.repeat(64), Date.now())
  })
  const result = await mcp(f, { action: 'sandbox', command: { type: 'apply', target: { networkId, revision: 3 }, sandbox: { level: 'owner', http: [{ origin: 'https://chat.example.test', methods: ['POST'] }], deny: ['~/.ssh'] }, grants: 'sandbox' } }, owner) as { outcomes: { podId: string, display: string, state: string }[] }
  // Each member gets its runtime grant and the HTTP grant, requested as itself and approved in the session.
  expect(result.outcomes.map(item => [item.podId, item.display.split(' ')[0], item.state])).toEqual([[podId, 'Run', 'approved'], [podId, 'HTTP', 'approved'], [deniedPodId, 'Run', 'approved'], [deniedPodId, 'HTTP', 'approved']])
  expect(idp.state.creates.map(request => request.requester)).toEqual([podSubject(podId), podSubject(podId), podSubject(deniedPodId), podSubject(deniedPodId)])
  for (const id of [podId, deniedPodId]) {
    expect(f.ledger.list(id)).toEqual([expect.objectContaining({ cliId: 'pod-http', origin: { networkId, revision: 3 }, approvedInSession: true }), expect.objectContaining({ cliId: 'pod-runtime', origin: { networkId, revision: 3 }, approvedInSession: true })])
    expect(f.ledger.sandbox(id)).toEqual({ level: 'owner', sources: [{ source: `network:${networkId}`, level: 'owner' }], deny: ['~/.ssh'], denySources: [{ source: `network:${networkId}`, deny: ['~/.ssh'] }] })
  }
  await expect(mcp(f, { action: 'sandbox', command: { type: 'apply', target: { networkId, revision: 2 }, sandbox: {} } }, owner)).rejects.toThrow('revision 3')
})

/** An application with its own executable and the reviewed gh fixture adapter, assigned in the Pod sandbox. */
function application(cliId: string, adapter: string): { resource: Record<string, unknown>, assignment: ProgramAssignment } {
  const executable = join(root, cliId); writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  const id = randomUUID()
  const assignment = { type: 'program', name: cliId, cliId, executable, executableHash: createHash('sha256').update(readFileSync(executable)).digest('hex'), adapterPath: adapter, adapterHash: createHash('sha256').update(readFileSync(adapter)).digest('hex'), stateId: randomUUID(), capability: `tool.app_${id.replaceAll('-', '')}.invoke`, networkHosts: [], entryFiles: [], environment: {} } as ProgramAssignment
  return { resource: { id, podId, revision: 1, kind: 'tool', state: 'ready', name: cliId, configuration: assignment }, assignment }
}
const ghApplication = () => application('gh', resolve('../../packages/shapes/test/fixtures/gh.toml'))

it('lets a whole-program grant cover a new command of that program but not another program', async () => {
  const gh = ghApplication()
  const f = await workerFixture({ resources: () => [program, gh.resource] })
  await mcp(f, { action: 'grants', command: { type: 'request', target: { podId }, grants: { programs: [{ application: 'gh' }] } } }, session())
  const [grant] = f.ledger.list(podId)
  expect(grant).toMatchObject({ cliId: 'gh', state: 'approved' })
  // Exact-command operations (repo create, pr merge, ...) stay outside a whole-program grant.
  expect(grant!.details.map(detail => detail.permission)).not.toContain('gh.repo[*]#create')
  const connection = f.connection(podId)
  for (const argv of [['issue', 'list', '--repo', 'openape/monorepo'], ['run', 'list', '--repo', 'another/repository']]) {
    const { authority, authorization } = await prepareProgramAuthorization(gh.assignment, connection, argv, undefined, f.grants.port(podId))
    await authority.authorize(authorization, AbortSignal.timeout(5000))
    expect(authorization.grantId).toBe(grant!.id)
  }
  expect(idp.state.tokens).toEqual([grant!.id, grant!.id])
  // Another program finds no covering grant; without an owner waiting it is refused and nothing is minted.
  const other = { ...program.configuration, executable: gh.assignment.executable, executableHash: gh.assignment.executableHash, entryFiles: [], networkHosts: [], environment: {} } as unknown as ProgramAssignment
  const { authority, authorization } = await prepareProgramAuthorization(other, connection, ['request', '--origin', 'https://api.example.test', '--method', 'GET'], undefined, f.grants.port(podId))
  await expect(authority.authorize(authorization, AbortSignal.timeout(5000))).rejects.toThrow('owner approval')
  expect(idp.state.tokens).toEqual([grant!.id, grant!.id])
})

it('runs a program only when the sandbox allows it and a grant covers it', async () => {
  const gh = ghApplication()
  const f = await workerFixture({ resources: () => [program, gh.resource] })
  const lease = (capabilities: string[]) => ({ capabilities, signal: AbortSignal.timeout(5000), assertCurrent: () => {} })
  const call = (resources: Record<string, unknown>[], capabilities: string[]) => invokeProgram(resources as never, podId, { application: 'gh', argv: ['issue', 'list', '--repo', 'openape/monorepo'] }, '/fixture/helper', root, {} as never, lease(capabilities), { connection: f.connection(podId), ledger: f.grants.port(podId), reach: { level: 'isolated', protectedPaths: [] } })
  // Sandbox allows, no grant: the Pod requests one and is refused while nobody approves; nothing is minted.
  await expect(call([gh.resource], [gh.assignment.capability])).rejects.toThrow('owner approval')
  expect(idp.state.tokens).toEqual([])
  await mcp(f, { action: 'grants', command: { type: 'request', target: { podId }, grants: { programs: [{ application: 'gh' }] } } }, session())
  // Grant present, sandbox denies (application not assigned or not declared): refused before any authorization.
  await expect(call([program], [gh.assignment.capability])).rejects.toThrow('not declared and assigned')
  await expect(call([gh.resource], [])).rejects.toThrow('not declared and assigned')
  expect(idp.state.tokens).toEqual([])
})

it('approves the runtime grant ahead of the first run, so the run starts without any approval wait', async () => {
  const f = await workerFixture()
  await mcp(f, { action: 'grants', command: { type: 'request', target: { podId }, grants: { runtime: true } } }, session())
  const run = f.start(podId)
  await expect(run.run).resolves.toEqual({ home: '/fixture/home', environment: {} })
  await run.call('shellClose')
  expect(f.approvals.filter(item => item.state === 'pending')).toEqual([])
  expect(idp.state.creates).toHaveLength(1); expect(idp.state.tokens).toEqual(['grant-1'])
})

it('never lets a whole-program grant or a script call move mail; only the archive port runs the move', async () => {
  const mail = application('o365-cli', resolve('examples/network-mail-archive-shapes.toml'))
  const f = await workerFixture({ resources: () => [program, mail.resource] })
  await mcp(f, { action: 'grants', command: { type: 'request', target: { podId }, grants: { programs: [{ application: 'o365-cli' }] } } }, session())
  const [grant] = f.ledger.list(podId)
  expect(grant!.details.map(detail => detail.action)).toEqual(['read', 'login'])
  const move = ['workflow', 'move', '--account', 'owner@example.test', '--message', 'm1', '--expected-version', 'v1', '--source-folder', 'inbox', '--destination', 'archive']
  const lease = { capabilities: [mail.assignment.capability], signal: AbortSignal.timeout(5000), assertCurrent: () => {} }
  // A script or its agent tool call: refused by the worker before anything is recorded, and by main before any grant.
  await expect(programWrite([mail.resource] as never, podId, lease.capabilities, { application: 'o365-cli', argv: move })).rejects.toThrow('approved archive port')
  await expect(invokeProgram([mail.resource] as never, podId, { application: 'o365-cli', argv: move }, '/fixture/helper', root, {} as never, lease, { connection: f.connection(podId), ledger: f.grants.port(podId), reach: { level: 'isolated', protectedPaths: [] } })).rejects.toThrow('approved archive port')
  expect(idp.state.tokens).toEqual([])
  // The archive port names the move explicitly and passes this check; it still needs its batch approval.
  await expect(resolveProgram(mail.assignment, move, 'move')).resolves.toMatchObject({ write: true })
})

it('approves the requested grant type unless the owner session explicitly chooses another one', async () => {
  const f = await workerFixture(); const owner = session()
  const request = (grantType: string, extra: Record<string, unknown> = {}) => idp.foreign({ requester: podSubject(podId), target_host: `pods:${podId}`, grant_type: grantType, ...extra })
  const once = request('once'); const timed = request('timed', { duration: 900 }); const widened = request('once')
  expect(await mcp(f, { action: 'grants', command: { type: 'approve', podId, grantId: once } }, owner)).toMatchObject({ grantType: 'once', requestedType: 'once', widened: false })
  expect(await mcp(f, { action: 'grants', command: { type: 'approve', podId, grantId: timed } }, owner)).toMatchObject({ grantType: 'timed', requestedType: 'timed', widened: false })
  expect(await mcp(f, { action: 'grants', command: { type: 'approve', podId, grantId: widened, grantType: 'always' } }, owner)).toMatchObject({ grantType: 'always', requestedType: 'once', widened: true })
  expect(idp.state.decisions.map(decision => decision.body)).toEqual([{ grant_type: 'once' }, { grant_type: 'timed', duration: 900 }, { grant_type: 'always' }])
})

it('binds an exact-command grant to its argv so that exact command can run', async () => {
  const gh = ghApplication()
  const f = await workerFixture({ resources: () => [program, gh.resource] })
  const argv = ['repo', 'create', 'example']
  await mcp(f, { action: 'grants', command: { type: 'request', target: { podId }, grants: { programs: [{ application: 'gh', argv }] } } }, session())
  expect(idp.state.creates[0]!.execution_context).toMatchObject({ argv: ['gh', ...argv], argv_hash: expect.any(String) })
  const { authority, authorization } = await prepareProgramAuthorization(gh.assignment, f.connection(podId), argv, undefined, f.grants.port(podId))
  await authority.authorize(authorization, AbortSignal.timeout(5000))
  expect(idp.state.tokens).toEqual(['grant-1'])
})

it('keeps a Pod\'s own grant and HTTP destination when a network declares the same origin', async () => {
  const own = { id: randomUUID(), podId, revision: 1, kind: 'tool', state: 'ready', name: 'https://chat.example.test', configuration: { type: 'http', origin: 'https://chat.example.test', methods: ['GET'], capability: 'tool.http_own.request', authentication: { type: 'ddisaAgent', credential: 'agent_key', subject: 'agent@example.test', issuer } } }
  const f = await workerFixture({ resources: () => [program, own] }); const owner = session(); const networkId = randomUUID()
  idp.state.reuse = true
  await mcp(f, { action: 'grants', command: { type: 'request', target: { podId }, grants: { http: [{ origin: 'https://chat.example.test', methods: ['POST'] }] } } }, owner)
  Object.assign(f.worker, { networks: async () => ({ networks: [{ id: networkId, revision: 1, state: 'paused', podIds: [podId] }] }) })
  const result = await mcp(f, { action: 'sandbox', command: { type: 'apply', target: { networkId, revision: 1 }, sandbox: { http: [{ origin: 'https://chat.example.test', methods: ['POST'] }] }, grants: { http: [{ origin: 'https://chat.example.test', methods: ['POST'] }] } } }, owner) as { kept: { podId: string, entry: string }[] }
  // The IdP returned the Pod's existing grant (200): it stays the Pod's own and is never revoked with the network.
  expect(f.ledger.list(podId)).toEqual([expect.objectContaining({ id: 'grant-1', origin: null })])
  expect(f.bound).toEqual([])
  expect(result.kept).toEqual([{ podId, entry: 'https://chat.example.test keeps its existing methods GET' }])
})
