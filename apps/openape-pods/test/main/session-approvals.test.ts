// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OwnerSession } from '../../src/main/connections/owner-session'
import { AgentAuthority } from '../../src/main/broker/authorization'
import { programIdentity } from '../../src/contracts/programs'
import type { ProgramAssignment } from '../../src/contracts/programs'
import { brokered, brokerRejections, closeProfiles, deniedPodId, identityProvider, issuer, owner, ownerToken, podId, podSubject, program, workerFixture } from './idp-fixture'

// Owner decisions October 10, 2026 (issue 1455): the MCP session acts with the owner's identity, so grants a Pod
// requests can be approved in that session without the human. Outside an active owner session no code path
// approves, the persisted setup login is never used for it, and a decision only reaches own-Pod grants.
vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() }, safeStorage: {}, app: { getPath: () => '/nonexistent', isPackaged: false }, shell: { openExternal: vi.fn(async () => {}) } }))
vi.mock('../../src/runtime/environment', () => ({ podDirectories: async () => ({ workspace: '/fixture/workspace', home: '/fixture/home' }), podEnvironment: async () => ({ workspace: '/fixture/workspace', home: '/fixture/home', environment: {} }), podEnvironmentValues: () => ({}), visibleEnvironment: () => ({}) }))

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

it('authorizes only one pinned owner CLI start and leaves downstream calls pending', async () => {
  const f = await workerFixture(); const owner = session(); const runId = randomUUID()
  const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
  const scriptHash = hash('Synthetic Pod source')
  const entry = join(root, 'runtime/script-entry.mjs'); mkdirSync(join(root, 'runtime')); writeFileSync(entry, 'Synthetic runtime entry')
  Object.assign((f.worker as unknown as { host: object }).host, { directory: root })
  Object.assign(f.worker, { cliStarts: new Map([[podId, { scriptHash, runId, owner }]]) })
  f.store.db.prepare('INSERT INTO pod_descriptions(pod_id,body) VALUES(?,?)').run(podId, 'Owner-provided context for the selected Pod')
  const run = f.start(podId, runId, 'manual', f.store.getPod(podId).name)
  await run.run
  const artifact = join(f.store.root, 'runs/script-artifacts', `${scriptHash}.mjs`)
  const call = { program: { name: basename(process.execPath), sha256: hash(readFileSync(process.execPath)) }, argv: [entry, '--input-channel', artifact, '', scriptHash], files: [{ path: artifact, sha256: scriptHash }, { path: entry, sha256: hash(readFileSync(entry)) }] }
  await expect(run.call('scriptGrant', call)).resolves.toBe(true)
  expect(idp.state.decisions).toEqual([])
  expect(idp.state.authorizations).toEqual([])
  const authority = new AgentAuthority(f.connection(podId), undefined, f.grants.port(podId))
  await expect(authority.requestProgram({ ...call, argv: ['-e', 'console.log(2 + 2)'] }, AbortSignal.timeout(1000))).resolves.toMatchObject({ state: 'pending' })
  await expect(run.call('scriptGrant', call)).resolves.toBe(true)
  expect(idp.state.decisions).toEqual([])
  expect(idp.state.authorizations).toHaveLength(1)
  expect(owner.active).toBe(false)
})

it.each(['foreign-run', 'changed-script', 'ended-session'])('refuses %s before accepting an owner CLI start', async (change) => {
  const f = await workerFixture(); const owner = session(); const runId = randomUUID()
  if (change === 'ended-session') await owner.close()
  const run = f.start(podId, runId); await run.run
  Object.assign(f.worker, { cliStarts: new Map([[podId, { scriptHash: 'a'.repeat(64), runId: change === 'foreign-run' ? randomUUID() : runId, owner }]]) })
  await expect(run.call('scriptGrant', { argv: ['foreign-script'] })).rejects.toThrow(/another run|ended|selected script/)
  expect(idp.state.authorizations).toEqual([])
  expect(idp.state.decisions).toEqual([])
})

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
const programCall = (assignment: ProgramAssignment, argv: string[]) => ({ program: programIdentity(assignment), argv })
/** A grant the owner approved at the IdP before; the IdP decides which commands it covers. */
function approvedGrant(details: Record<string, unknown>[], extra: Record<string, unknown> = {}): string {
  const id = idp.foreign({ requester: podSubject(podId), target_host: `pods:${podId}`, authorization_details: details, ...extra }); idp.decide(id, 'approved'); return id
}

it('previews exact commands at the IdP and refuses whole-program requests from the desktop', async () => {
  const gh = ghApplication()
  const f = await workerFixture({ resources: () => [program, gh.resource] })
  // A whole program is granted at the IdP, never resolved by the desktop.
  const whole = await mcp(f, { action: 'grants', command: { type: 'request', target: { podId }, grants: { programs: [{ application: 'gh' }] } } }, session()) as { outcomes: { error?: string }[] }
  expect(whole.outcomes).toEqual([expect.objectContaining({ error: expect.stringContaining('decided at the IdP') })])
  const grant = approvedGrant([{ type: 'openape_cli', cli_id: 'gh', operation_id: '*', resource_chain: [], action: 'read', permission: 'gh.*#read', display: 'Every gh read', risk: 'low' }])
  const authority = new AgentAuthority(f.connection(podId), undefined, f.grants.port(podId))
  for (const argv of [['issue', 'list', '--repo', 'openape/monorepo'], ['run', 'list', '--repo', 'another/repository']]) {
    await expect(authority.requestProgram(programCall(gh.assignment, argv), AbortSignal.timeout(5000))).resolves.toEqual({ grantId: grant, state: 'approved' })
  }
  expect(idp.state.tokens).toEqual([grant, grant])
  // The desktop sent only the program and the exact command; the IdP made no new request.
  expect(idp.state.authorizations.map(body => Object.keys(body).sort())).toEqual([['argv', 'audience', 'grant_type', 'program', 'summary', 'target_host'], ['argv', 'audience', 'grant_type', 'program', 'summary', 'target_host']])
  expect(idp.state.creates).toEqual([])
  // Another program finds no covering grant; its preview stays pending.
  const other = { ...program.configuration } as unknown as ProgramAssignment
  await expect(authority.requestProgram(programCall(other, ['request', '--origin', 'https://api.example.test']), AbortSignal.timeout(5000))).resolves.toMatchObject({ state: 'pending' })
  expect(idp.state.tokens).toEqual([grant, grant])
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

it('previews and approves one exact command; a different argv still requires its own decision', async () => {
  const gh = ghApplication()
  const f = await workerFixture({ resources: () => [program, gh.resource] })
  const argv = ['repo', 'create', 'example']
  const result = await mcp(f, { action: 'grants', command: { type: 'request', target: { podId }, grants: { programs: [{ application: 'gh', argv }] } } }, session()) as { outcomes: { grantId: string, state: string, approvedInSession: boolean }[] }
  expect(result.outcomes).toEqual([expect.objectContaining({ grantId: 'grant-1', state: 'approved', approvedInSession: true })])
  expect(idp.state.authorizations[0]).toMatchObject({ program: { name: 'gh', sha256: gh.assignment.executableHash }, argv })
  expect(idp.state.creates).toEqual([])
  const authority = new AgentAuthority(f.connection(podId), undefined, f.grants.port(podId))
  await expect(authority.requestProgram(programCall(gh.assignment, argv), AbortSignal.timeout(5000))).resolves.toMatchObject({ grantId: 'grant-1' })
  expect(idp.state.tokens).toEqual(['grant-1'])
  // The exact grant covers no other argv: its preview asks again and stays pending.
  await expect(authority.requestProgram(programCall(gh.assignment, [...argv, '--private']), AbortSignal.timeout(5000))).resolves.toMatchObject({ state: 'pending' })
})

it('uses the same concrete interpreter grant through bulk MCP preparation and the application grant command', async () => {
  const reader = application('reader')
  const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
  const script = join(root, 'reader.cjs'); writeFileSync(script, 'throw new Error("Preparation must not execute code")')
  const descriptor = join(root, 'runtime.json'); writeFileSync(descriptor, '{}')
  Object.assign(reader.assignment, { executable: script, executableHash: digest(readFileSync(script)), runtime: { executable: process.execPath, executableHash: digest(readFileSync(process.execPath)), arguments: ['--use-env-proxy', script], readDirectories: [], environment: {}, descriptor: { path: descriptor, hash: digest('{}') } } })
  const f = await workerFixture({ resources: () => [program, reader.resource] })
  const request = (argv: string[], approve = true) => ({ action: 'grants', command: { type: 'request', target: { podId }, grants: { programs: [{ application: 'reader', argv }] }, approve } })
  const result = await mcp(f, request(['list']), session()) as { outcomes: { grantId: string }[] }
  expect(result.outcomes[0]!.grantId).toBe('grant-1')
  expect(idp.state.authorizations[0]).toMatchObject({ program: { name: basename(process.execPath), sha256: digest(readFileSync(process.execPath)) }, argv: ['--use-env-proxy', script, 'list'], files: [{ path: script, sha256: reader.assignment.executableHash }] })
  await f.worker.program({ type: 'grant', podId, applicationId: reader.resource.id as string, epoch: 1, argv: ['list'] })
  for (const key of ['program', 'argv', 'files', 'grant_type']) expect(idp.state.authorizations[1]![key]).toEqual(idp.state.authorizations[0]![key])
  expect(idp.state.tokens).toEqual(['grant-1'])
  const changed = await mcp(f, request(['list', '--new-argument'], false), session()) as { outcomes: { state: string }[] }
  expect(changed.outcomes[0]!.state).toBe('pending')
  const count = idp.state.authorizations.length
  writeFileSync(descriptor, '{"changed":true}')
  const replaced = await mcp(f, request(['list']), session()) as { outcomes: { error: string }[] }
  expect(replaced.outcomes[0]!.error).toContain('integrity mismatch')
  expect(idp.state.authorizations).toHaveLength(count)
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
