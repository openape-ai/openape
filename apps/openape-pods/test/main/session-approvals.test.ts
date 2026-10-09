// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OwnerSession } from '../../src/main/connections/owner-session'
import { invokeProgram } from '../../src/main/programs/invoke'
import { prepareProgramAuthorization } from '../../src/main/programs/session'
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
  const result = await mcp(f, { action: 'sandbox', command: { type: 'apply', target: { networkId, revision: 3 }, sandbox: { level: 'owner', http: [{ origin: 'https://chat.example.test', methods: ['POST'] }] }, grants: 'sandbox' } }, owner) as { outcomes: { podId: string, display: string, state: string }[] }
  // Each member gets its runtime grant and the HTTP grant, requested as itself and approved in the session.
  expect(result.outcomes.map(item => [item.podId, item.display.split(' ')[0], item.state])).toEqual([[podId, 'Run', 'approved'], [podId, 'HTTP', 'approved'], [deniedPodId, 'Run', 'approved'], [deniedPodId, 'HTTP', 'approved']])
  expect(idp.state.creates.map(request => request.requester)).toEqual([podSubject(podId), podSubject(podId), podSubject(deniedPodId), podSubject(deniedPodId)])
  for (const id of [podId, deniedPodId]) {
    expect(f.ledger.list(id)).toEqual([expect.objectContaining({ cliId: 'pod-http', origin: { networkId, revision: 3 }, approvedInSession: true }), expect.objectContaining({ cliId: 'pod-runtime', origin: { networkId, revision: 3 }, approvedInSession: true })])
    expect(f.ledger.sandbox(id)).toEqual({ level: 'owner', sources: [{ source: `network:${networkId}`, level: 'owner' }] })
  }
  await expect(mcp(f, { action: 'sandbox', command: { type: 'apply', target: { networkId, revision: 2 }, sandbox: {} } }, owner)).rejects.toThrow('revision 3')
})

/** An application with its own executable and the reviewed gh fixture adapter, assigned in the Pod sandbox. */
function ghApplication(): { resource: Record<string, unknown>, assignment: ProgramAssignment } {
  const executable = join(root, 'gh'); writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  const ghAdapter = resolve('../../packages/shapes/test/fixtures/gh.toml')
  const id = randomUUID()
  const assignment = { type: 'program', name: 'gh', cliId: 'gh', executable, executableHash: createHash('sha256').update(readFileSync(executable)).digest('hex'), adapterPath: ghAdapter, adapterHash: createHash('sha256').update(readFileSync(ghAdapter)).digest('hex'), stateId: randomUUID(), capability: `tool.app_${id.replaceAll('-', '')}.invoke`, networkHosts: [], entryFiles: [], environment: {} } as ProgramAssignment
  return { resource: { id, podId, revision: 1, kind: 'tool', state: 'ready', name: 'gh', configuration: assignment }, assignment }
}

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
  const call = (resources: Record<string, unknown>[], capabilities: string[]) => invokeProgram(resources as never, podId, { application: 'gh', argv: ['issue', 'list', '--repo', 'openape/monorepo'] }, '/fixture/helper', root, {} as never, lease(capabilities), { connection: f.connection(podId), ledger: f.grants.port(podId), level: 'isolated' })
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
