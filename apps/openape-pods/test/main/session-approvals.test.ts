// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computeArgvHash } from '@openape/grants'
import { OwnerSession } from '../../src/main/connections/owner-session'
import { invokeProgram } from '../../src/main/programs/invoke'
import { AgentAuthority } from '../../src/main/broker/authorization'
import { programCall } from '../../src/main/programs/session'
import { programIdentity } from '../../src/contracts/programs'
import type { ProgramAssignment } from '../../src/contracts/programs'
import { brokered, brokerRejections, closeProfiles, deniedPodId, identityProvider, issuer, owner, ownerToken, podId, podSubject, program, workerFixture } from './idp-fixture'

// Owner decisions October 10, 2026 (issue 1455): the MCP session acts with the owner's identity, so grants a Pod
// requests can be approved in that session without the human. Outside an active owner session no code path
// approves, the persisted setup login is never used for it, and a decision only reaches own-Pod grants.
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

/** An application assigned by path and file hash only (issue 1473, revision 4). */
function application(cliId: string): { resource: Record<string, unknown>, assignment: ProgramAssignment } {
  const executable = join(root, cliId); writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  const id = randomUUID()
  const assignment = { type: 'program', name: cliId, cliId, executable, executableHash: createHash('sha256').update(readFileSync(executable)).digest('hex'), stateId: randomUUID(), capability: `tool.app_${id.replaceAll('-', '')}.invoke`, networkHosts: [], entryFiles: [], environment: {} } as ProgramAssignment
  return { resource: { id, podId, revision: 1, kind: 'tool', state: 'ready', name: cliId, configuration: assignment }, assignment }
}
const ghApplication = () => application('gh')
/** A grant the owner approved at the IdP before; the IdP decides which commands it covers. */
function approvedGrant(details: Record<string, unknown>[], extra: Record<string, unknown> = {}): string {
  const id = idp.foreign({ requester: podSubject(podId), target_host: `pods:${podId}`, authorization_details: details, ...extra }); idp.decide(id, 'approved'); return id
}

it('runs new commands under a grant the IdP finds, refuses whole-program requests from the desktop and asks for another program', async () => {
  const gh = ghApplication()
  const f = await workerFixture({ resources: () => [program, gh.resource] })
  // A whole program is granted at the IdP, never resolved by the desktop.
  const whole = await mcp(f, { action: 'grants', command: { type: 'request', target: { podId }, grants: { programs: [{ application: 'gh' }] } } }, session()) as { outcomes: { error?: string }[] }
  expect(whole.outcomes).toEqual([expect.objectContaining({ error: expect.stringContaining('decided at the IdP') })])
  const grant = approvedGrant([{ type: 'openape_cli', cli_id: 'gh', operation_id: '*', resource_chain: [], action: 'read', permission: 'gh.*#read', display: 'Every gh read', risk: 'low' }])
  const authority = new AgentAuthority(f.connection(podId), undefined, f.grants.port(podId))
  for (const argv of [['issue', 'list', '--repo', 'openape/monorepo'], ['run', 'list', '--repo', 'another/repository']]) {
    await expect(authority.authorizeProgram(programCall(gh.assignment, argv), AbortSignal.timeout(5000))).resolves.toEqual({ grantId: grant, actions: ['read'], programs: ['gh'] })
  }
  expect(idp.state.tokens).toEqual([grant, grant])
  // The desktop sent only the program and the exact command; the IdP made no new request.
  expect(idp.state.authorizations.map(body => Object.keys(body).sort())).toEqual([['argv', 'audience', 'grant_type', 'program', 'summary', 'target_host'], ['argv', 'audience', 'grant_type', 'program', 'summary', 'target_host']])
  expect(idp.state.creates).toEqual([])
  // Another program finds no covering grant; without an owner waiting it is refused and nothing is minted.
  const other = { ...program.configuration } as unknown as ProgramAssignment
  await expect(authority.authorizeProgram(programCall(other, ['request', '--origin', 'https://api.example.test']), AbortSignal.timeout(5000))).rejects.toThrow('owner approval')
  expect(idp.state.tokens).toEqual([grant, grant])
})

it('runs a program only when the sandbox allows it and the IdP authorizes the command', async () => {
  const gh = ghApplication()
  const f = await workerFixture({ resources: () => [program, gh.resource] })
  const lease = (capabilities: string[]) => ({ capabilities, signal: AbortSignal.timeout(5000), assertCurrent: () => {} })
  const call = (resources: Record<string, unknown>[], capabilities: string[]) => invokeProgram(resources as never, podId, { application: 'gh', argv: ['issue', 'list', '--repo', 'openape/monorepo'] }, '/fixture/helper', root, {} as never, lease(capabilities), { connection: f.connection(podId), ledger: f.grants.port(podId), reach: { level: 'isolated', protectedPaths: [] } })
  // Sandbox allows, no grant: the IdP opens a request and the call is refused while nobody approves; nothing is minted.
  await expect(call([gh.resource], [gh.assignment.capability])).rejects.toThrow('owner approval')
  expect(idp.state.tokens).toEqual([])
  // The owner approves this exact command in the session.
  await mcp(f, { action: 'grants', command: { type: 'request', target: { podId }, grants: { programs: [{ application: 'gh', argv: ['issue', 'list', '--repo', 'openape/monorepo'] }] } } }, session())
  const asked = idp.state.authorizations.length
  // Grant present, sandbox denies (application not assigned or not declared): refused before any authorization.
  await expect(call([program], [gh.assignment.capability])).rejects.toThrow('not declared and assigned')
  await expect(call([gh.resource], [])).rejects.toThrow('not declared and assigned')
  expect(idp.state.authorizations).toHaveLength(asked); expect(idp.state.tokens).toEqual([])
  // Sandbox and IdP allow: the token is verified and the call proceeds to the sandbox launch (the fixture has no helper).
  await expect(call([gh.resource], [gh.assignment.capability])).rejects.not.toThrow(/approval|grant|not declared/i)
  expect(idp.state.tokens).toEqual(['grant-1'])
})

it('runs an exact command with its consumed program approval instead of a grant, and nothing without either (issue 1468)', async () => {
  const gh = ghApplication()
  const f = await workerFixture({ resources: () => [program, gh.resource] })
  const lease = { capabilities: [gh.assignment.capability], signal: AbortSignal.timeout(5000), assertCurrent: () => {} }
  const call = (approval?: () => Promise<void>) => invokeProgram([gh.resource] as never, podId, { application: 'gh', argv: ['repo', 'create', 'openape/new'] }, '/fixture/helper', root, {} as never, lease, { connection: f.connection(podId), ledger: f.grants.port(podId), reach: { level: 'isolated', protectedPaths: [] }, ...(approval ? { approval } : {}) })
  // Neither a grant nor an approval: unchanged, the IdP opens a request and the call is refused while nobody approves.
  await expect(call()).rejects.toThrow('owner approval')
  const asked = idp.state.authorizations.length
  // The worker's check of the consumed approval refuses: nothing starts.
  await expect(call(async () => { throw new Error('No consumed approval of this Pod names this exact command') })).rejects.toThrow('No consumed approval')
  // A confirmed approval replaces the IdP authorization: no request and no token; the call proceeds to the sandbox.
  const confirmed = vi.fn(async () => {})
  await expect(call(confirmed)).rejects.not.toThrow(/approval|grant/i)
  expect(confirmed).toHaveBeenCalledTimes(1)
  expect(idp.state.authorizations).toHaveLength(asked)
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

it('never lets a script call move mail, whatever grant covers it; only the archive port runs the move', async () => {
  const mail = application('o365-cli')
  const f = await workerFixture({ resources: () => [program, mail.resource] })
  const move = ['workflow', 'move', '--account', 'owner@example.test', '--message', 'm1', '--expected-version', 'v1', '--source-folder', 'inbox', '--destination', 'archive']
  approvedGrant([{ type: 'openape_cli', cli_id: 'o365-cli', operation_id: 'workflow.move', resource_chain: [], action: 'move', permission: 'o365-cli.mail[*]#move', display: 'Move mail', risk: 'high' }], { execution_context: { argv_hash: await computeArgvHash(['o365-cli', ...move]) } })
  const lease = { capabilities: [mail.assignment.capability], signal: AbortSignal.timeout(5000), assertCurrent: () => {} }
  const call = (port?: 'move') => invokeProgram([mail.resource] as never, podId, { application: 'o365-cli', argv: move }, '/fixture/helper', root, {} as never, lease, { connection: f.connection(podId), ledger: f.grants.port(podId), reach: { level: 'isolated', protectedPaths: [] } }, port)
  // A script or its agent tool call: the IdP covers the move, yet the desktop refuses it before anything starts.
  await expect(call()).rejects.toThrow('approved archive service')
  // The archive port names the move explicitly and passes this check; it then reaches the sandbox launch.
  await expect(call('move')).rejects.not.toThrow(/archive service|move operation/)
  expect(programIdentity(mail.assignment)).toEqual({ name: 'o365-cli', sha256: mail.assignment.executableHash })
  // Fail closed (review finding): an exact-command fallback of the same move, resolved without a shape, is refused too.
  const fallback = ['workflow', 'move', '--account', 'owner@example.test', '--message', 'm2', '--expected-version', 'v1', '--source-folder', 'inbox', '--destination', 'archive']
  approvedGrant([{ type: 'openape_cli', cli_id: 'o365-cli', operation_id: '_exact', resource_chain: [], action: 'exec', permission: 'o365-cli.command#exec', display: 'Exact command', risk: 'high', constraints: { exact_command: true } }], { execution_context: { argv_hash: await computeArgvHash(['o365-cli', ...fallback]) } })
  await expect(invokeProgram([mail.resource] as never, podId, { application: 'o365-cli', argv: fallback }, '/fixture/helper', root, {} as never, lease, { connection: f.connection(podId), ledger: f.grants.port(podId), reach: { level: 'isolated', protectedPaths: [] } })).rejects.toThrow('approved archive service')
  // A mail binary assigned under another name: the IdP resolves its hash to the o365 shape, so the move stays refused.
  const renamed = application('renamed-mail')
  approvedGrant([{ type: 'openape_cli', cli_id: 'o365', operation_id: '_exact', resource_chain: [], action: 'exec', permission: 'o365.command#exec', display: 'Exact command', risk: 'high' }], { execution_context: { argv_hash: await computeArgvHash(['renamed-mail', ...move]) } })
  await expect(invokeProgram([renamed.resource] as never, podId, { application: 'renamed-mail', argv: move }, '/fixture/helper', root, {} as never, { ...lease, capabilities: [renamed.assignment.capability] }, { connection: f.connection(podId), ledger: f.grants.port(podId), reach: { level: 'isolated', protectedPaths: [] } })).rejects.toThrow('approved archive service')
  // A known non-moving effect of the mail program still runs.
  const categorize = ['workflow', 'categorize', '--account', 'owner@example.test', '--message', 'm1', '--add', 'Newsletter']
  approvedGrant([{ type: 'openape_cli', cli_id: 'o365-cli', operation_id: 'workflow.categorize', resource_chain: [], action: 'categorize', permission: 'o365-cli.mail[*]#categorize', display: 'Categorize mail', risk: 'medium' }], { execution_context: { argv_hash: await computeArgvHash(['o365-cli', ...categorize]) } })
  await expect(invokeProgram([mail.resource] as never, podId, { application: 'o365-cli', argv: categorize }, '/fixture/helper', root, {} as never, lease, { connection: f.connection(podId), ledger: f.grants.port(podId), reach: { level: 'isolated', protectedPaths: [] } })).rejects.not.toThrow(/archive service|approval/)
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

it('asks the IdP about one exact command, approves it in the session and then runs it with a token for exactly that command', async () => {
  const gh = ghApplication()
  const f = await workerFixture({ resources: () => [program, gh.resource] })
  const argv = ['repo', 'create', 'example']
  const result = await mcp(f, { action: 'grants', command: { type: 'request', target: { podId }, grants: { programs: [{ application: 'gh', argv }] } } }, session()) as { outcomes: { grantId: string, state: string, approvedInSession: boolean }[] }
  expect(result.outcomes).toEqual([expect.objectContaining({ grantId: 'grant-1', state: 'approved', approvedInSession: true })])
  expect(idp.state.authorizations[0]).toMatchObject({ program: { name: 'gh', sha256: gh.assignment.executableHash }, argv })
  expect(idp.state.creates).toEqual([])
  const authority = new AgentAuthority(f.connection(podId), undefined, f.grants.port(podId))
  await expect(authority.authorizeProgram(programCall(gh.assignment, argv), AbortSignal.timeout(5000))).resolves.toMatchObject({ grantId: 'grant-1' })
  expect(idp.state.tokens).toEqual(['grant-1'])
  // The exact grant covers no other argv: that command asks again and is refused while nobody approves.
  await expect(authority.authorizeProgram(programCall(gh.assignment, [...argv, '--private']), AbortSignal.timeout(5000))).rejects.toThrow('owner approval')
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

it('delegates only grants scopes for the IdP, for at most 90 days, to the agent of an own Pod and only as the signed-in owner (issue 1473)', async () => {
  const assigned: Record<string, unknown>[] = [program]
  const f = await workerFixture({ resources: () => assigned })
  const delegate = (fields: Record<string, unknown> = {}) => ({ action: 'grants', command: { type: 'delegate', podId, scopes: ['grants:read', 'grants:request'], ...fields } })
  const assignAgent = (subject: string, agentIssuer = issuer) => assigned.push({ id: randomUUID(), podId, revision: 1, kind: 'tool', state: 'ready', name: agentIssuer, configuration: { type: 'http', origin: agentIssuer, methods: ['GET', 'POST'], capability: 'tool.http_idp.request', authentication: { type: 'ddisaAgent', credential: 'agent_key', subject, issuer: agentIssuer } } })

  // Refused before any IdP call: other scopes, a chosen audience or delegate, an unbounded or too long lifetime.
  for (const fields of [{ scopes: ['grants:approve'] }, { scopes: ['grants:read', 'profile'] }, { audience: 'https://sp.example.test' }, { delegate: 'stranger@example.test' }, { days: 91 }, { days: 0 }]) {
    await expect(mcp(f, delegate(fields), session())).rejects.toThrow(/grants:read, grants:request or both|Invalid grants command fields|1 to 90 days/)
  }
  // The delegate is the agent the Pod authenticates as at the owner's IdP, never a free choice.
  await expect(mcp(f, delegate(), session())).rejects.toThrow('exactly one such HTTP destination')
  assignAgent('foreign-agent@example.test', 'https://id.foreign.test')
  await expect(mcp(f, delegate(), session())).rejects.toThrow('exactly one such HTTP destination')
  expect(idp.state.delegations).toEqual([])

  assignAgent('upgrader@example.test')
  await expect(mcp(f, delegate(), null)).rejects.toThrow('active owner session')
  const created = await mcp(f, delegate({ days: 30 }), session())
  expect(created).toEqual({ delegation: 'delegation-1', issuer, podId, delegate: 'upgrader@example.test', audience: issuer, scopes: ['grants:read', 'grants:request'], expiresAt: 1_000_000 + 30 * 86400 })
  expect(idp.state.delegations).toEqual([{ delegate: 'upgrader@example.test', audience: issuer, scopes: ['grants:read', 'grants:request'], grant_type: 'timed', duration: 30 * 86400 }])
  await mcp(f, delegate({ scopes: ['grants:read'] }), session())
  expect(idp.state.delegations[1]).toMatchObject({ scopes: ['grants:read'], duration: 90 * 86400 })
})
