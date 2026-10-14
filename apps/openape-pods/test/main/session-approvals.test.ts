// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OwnerSession } from '../../src/main/connections/owner-session'
import { invokeProgram } from '../../src/main/programs/invoke'
import { assertDeclaredOptions, prepareProgramAuthorization, resolveProgram } from '../../src/main/programs/session'
import { programWrite } from '../../src/worker/runs/program-effects'
import type { ProgramAssignment } from '../../src/contracts/programs'
import { brokered, brokerRejections, closeProfiles, deniedPodId, identityProvider, issuer, owner, ownerToken, podId, podSubject, program, workerFixture } from './idp-fixture'

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
afterEach(async () => { expect(await brokerRejections(idp.state.creates)).toEqual([]); vi.unstubAllGlobals(); vi.clearAllMocks(); closeProfiles(); rmSync(root, { recursive: true, force: true }) })

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

it('applies a Pod sandbox with its level and denylist and requests its grants as the Pod in the session', async () => {
  const f = await workerFixture(); const owner = session()
  const result = await mcp(f, { action: 'sandbox', command: { type: 'apply', target: { podId }, sandbox: { level: 'owner', http: [{ origin: 'https://chat.example.test', methods: ['POST'] }], deny: ['~/.ssh'] }, grants: 'sandbox' } }, owner) as { outcomes: { podId: string, display: string, state: string }[] }
  expect(result.outcomes.map(item => [item.podId, item.display.split(' ')[0], item.state])).toEqual([[podId, 'Run', 'approved'], [podId, 'HTTP', 'approved']])
  expect(idp.state.creates.map(request => request.requester)).toEqual([podSubject(podId), podSubject(podId)])
  expect(f.ledger.list(podId)).toEqual([expect.objectContaining({ cliId: 'pod-http', approvedInSession: true }), expect.objectContaining({ cliId: 'pod-runtime', approvedInSession: true })])
  expect(f.ledger.sandbox(podId)).toEqual({ level: 'owner', deny: ['~/.ssh'] })
  await expect(mcp(f, { action: 'sandbox', command: { type: 'apply', target: { networkId: randomUUID(), revision: 1 }, sandbox: {} } }, owner)).rejects.toThrow('A grant target names one podId')
})

/** An application with its own executable and the reviewed gh fixture adapter, assigned in the Pod sandbox as a tested registry adapter. */
function application(cliId: string, adapter: string): { resource: Record<string, unknown>, assignment: ProgramAssignment } {
  const executable = join(root, cliId); writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  const id = randomUUID(); const adapterHash = createHash('sha256').update(readFileSync(adapter)).digest('hex')
  const assignment = { type: 'program', name: cliId, cliId, executable, executableHash: createHash('sha256').update(readFileSync(executable)).digest('hex'), adapterPath: adapter, adapterHash, registry: { id: cliId, digest: `SHA-256:${adapterHash}` }, cliVersion: { version: '2.86', tested: true }, stateId: randomUUID(), capability: `tool.app_${id.replaceAll('-', '')}.invoke`, networkHosts: [], entryFiles: [], environment: {} } as ProgramAssignment
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

it('runs an exact command with its consumed program approval instead of a grant, and nothing without either (issue 1468)', async () => {
  const gh = ghApplication()
  const f = await workerFixture({ resources: () => [program, gh.resource] })
  const lease = { capabilities: [gh.assignment.capability], signal: AbortSignal.timeout(5000), assertCurrent: () => {} }
  const call = (approval?: () => Promise<void>) => invokeProgram([gh.resource] as never, podId, { application: 'gh', argv: ['repo', 'create', 'openape/new'] }, '/fixture/helper', root, {} as never, lease, { connection: f.connection(podId), ledger: f.grants.port(podId), reach: { level: 'isolated', protectedPaths: [] }, ...(approval ? { approval } : {}) })
  // Neither a grant nor an approval: unchanged, the Pod requests a grant and is refused while nobody approves.
  await expect(call()).rejects.toThrow('owner approval')
  const requested = idp.state.creates.length
  // The worker's check of the consumed approval refuses: nothing starts.
  await expect(call(async () => { throw new Error('No consumed approval of this Pod names this exact command') })).rejects.toThrow('No consumed approval')
  // A confirmed approval replaces the grant: no grant request and no grant token; the call proceeds to the sandbox.
  const confirmed = vi.fn(async () => {})
  // An option the operation does not declare is refused before the approval is even checked.
  await expect(invokeProgram([gh.resource] as never, podId, { application: 'gh', argv: ['repo', 'create', 'openape/new', '--clone'] }, '/fixture/helper', root, {} as never, lease, { connection: f.connection(podId), ledger: f.grants.port(podId), reach: { level: 'isolated', protectedPaths: [] }, approval: confirmed })).rejects.toThrow('does not declare')
  expect(confirmed).not.toHaveBeenCalled()
  await expect(call(confirmed)).rejects.not.toThrow(/approval|grant/i)
  expect(confirmed).toHaveBeenCalledTimes(1)
  expect(idp.state.creates).toHaveLength(requested)
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
  await expect(programWrite([mail.resource] as never, podId, lease.capabilities, { application: 'o365-cli', argv: move })).rejects.toThrow('approved archive service')
  await expect(invokeProgram([mail.resource] as never, podId, { application: 'o365-cli', argv: move }, '/fixture/helper', root, {} as never, lease, { connection: f.connection(podId), ledger: f.grants.port(podId), reach: { level: 'isolated', protectedPaths: [] } })).rejects.toThrow('approved archive service')
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

it('keeps a Pod\'s own HTTP destination when a sandbox declares the same origin again', async () => {
  const own = { id: randomUUID(), podId, revision: 1, kind: 'tool', state: 'ready', name: 'https://chat.example.test', configuration: { type: 'http', origin: 'https://chat.example.test', methods: ['GET'], capability: 'tool.http_own.request', authentication: { type: 'ddisaAgent', credential: 'agent_key', subject: 'agent@example.test', issuer } } }
  const f = await workerFixture({ resources: () => [program, own] }); const owner = session()
  const result = await mcp(f, { action: 'sandbox', command: { type: 'apply', target: { podId }, sandbox: { http: [{ origin: 'https://chat.example.test', methods: ['POST'] }] } } }, owner) as { kept: { podId: string, entry: string }[] }
  expect(f.bound).toEqual([])
  expect(result.kept).toEqual([{ podId, entry: 'https://chat.example.test keeps its existing methods GET' }])
})

// Issue 1462: a revoke of a brokered Pod grant went to the agent provider with the Pod token and failed with 404.
it('revokes a brokered Pod grant as the owner in the session and records the state the IdP shows', async () => {
  idp = identityProvider({ brokered }); vi.stubGlobal('fetch', idp.fetch)
  const f = await workerFixture({ brokered }); const owner = session()
  const revoke = (grantId: string) => ({ action: 'grants', command: { type: 'revoke', podId, grantId } })
  await mcp(f, httpGrant(), owner)
  await mcp(f, { action: 'grants', command: { type: 'request', target: { podId }, grants: { http: [{ origin: 'https://api.example.test', methods: ['GET'] }] } } }, owner)
  await expect(mcp(f, revoke('grant-1'), null)).rejects.toThrow('active owner session')
  expect(f.ledger.list(podId).map(grant => [grant.id, grant.state]).sort()).toEqual([['grant-1', 'approved'], ['grant-2', 'approved']])
  expect(await mcp(f, revoke('grant-1'), owner)).toMatchObject({ grant: { id: 'grant-1', state: 'revoked' } })
  expect(idp.state.decisions.filter(decision => decision.action === 'revoke')).toEqual([{ action: 'revoke', id: 'grant-1', bearer: ownerToken, body: {} }])
  // A grant the owner already revoked at the IdP only updates the ledger, also without a session; a retry changes nothing.
  idp.decide('grant-2', 'revoked')
  expect(await mcp(f, revoke('grant-2'), null)).toMatchObject({ grant: { id: 'grant-2', state: 'revoked' } })
  expect(await mcp(f, revoke('grant-1'), owner)).toMatchObject({ grant: { id: 'grant-1', state: 'revoked' } })
  expect(idp.state.decisions.filter(decision => decision.action === 'revoke')).toHaveLength(1)
  expect(f.ledger.list(podId).map(grant => [grant.id, grant.state]).sort()).toEqual([['grant-1', 'revoked'], ['grant-2', 'revoked']])
})

it('revokes a direct Pod grant as the requesting Pod without an owner session', async () => {
  const f = await workerFixture()
  await mcp(f, httpGrant(), session())
  expect(await mcp(f, { action: 'grants', command: { type: 'revoke', podId, grantId: 'grant-1' } }, null)).toMatchObject({ grant: { id: 'grant-1', state: 'revoked' } })
  expect(idp.state.decisions.filter(decision => decision.action === 'revoke')).toEqual([{ action: 'revoke', id: 'grant-1', bearer: 'SYNTHETIC_POD_AGENT', body: {} }])
})

it('accepts only declared options for approved commands, including declared global options (issue 1468)', () => {
  const push = { command: ['push'], required_options: ['force-with-lease'], value_options: ['repo'], flag_options: ['atomic'], global_options: ['C=repository'] }
  expect(() => assertDeclaredOptions(push, ['-C', '/repo', 'push', '--force-with-lease=x:1', '--repo', 'origin', '--atomic', 'origin', 'main'])).not.toThrow()
  expect(() => assertDeclaredOptions(push, ['-c', 'core.sshCommand=evil', 'push', 'origin', 'main'])).toThrow('passes -c')
  expect(() => assertDeclaredOptions(push, ['push', '--upload-pack=evil', 'origin', 'main'])).toThrow('passes --upload-pack')
  expect(() => assertDeclaredOptions(push, ['push', '-fu', 'origin', 'main'])).toThrow('passes -fu')
  expect(() => assertDeclaredOptions(push, ['push', '--', '--atomic'])).toThrow('passes --')
  // The dash form must match exactly what git reads: no -longname, no --x for a one-letter option, no bundles or attached values.
  expect(() => assertDeclaredOptions(push, ['push', '-repo', 'origin', 'main'])).toThrow('passes -repo')
  expect(() => assertDeclaredOptions(push, ['--C', '/repo', 'push', 'origin', 'main'])).toThrow('passes --C')
  expect(() => assertDeclaredOptions(push, ['-Cfoo', 'push', 'origin', 'main'])).toThrow('passes -Cfoo')
  expect(() => assertDeclaredOptions({ ...push, flag_options: ['a', 'b', 'c'] }, ['push', '-abc', 'origin', 'main'])).toThrow('passes -abc')
  expect(() => assertDeclaredOptions({ ...push, flag_options: ['a', 'b', 'c'] }, ['push', '-a', '-b', '-c', 'origin', 'main'])).not.toThrow()
  expect(() => assertDeclaredOptions({ ...push, value_options: ['r'] }, ['push', '--r=x', 'origin', 'main'])).toThrow('passes --r')
  expect(() => assertDeclaredOptions(push, ['push', '-force-with-lease=x:1', 'origin', 'main'])).toThrow('passes -force-with-lease')
  expect(() => assertDeclaredOptions({ command: ['push'] }, ['push', '--force', 'origin', 'main'])).toThrow('passes --force')
  // A global option's value must not swallow an option the check would otherwise refuse.
  expect(() => assertDeclaredOptions(push, ['-C', '--upload-pack=evil', 'push', 'origin', 'main'])).toThrow('passes -C')
  expect(() => assertDeclaredOptions(push, ['-C'])).toThrow('passes -C')
})
