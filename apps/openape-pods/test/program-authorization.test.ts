// @vitest-environment node
import { createServer } from 'node:http'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterEach, expect, it } from 'vitest'
import { computeArgvHash } from '@openape/grants'
import { AgentAuthority, RunGrantTokens } from '../src/main/broker/authorization'
import type { Grant, ProgramCall } from '../src/main/broker/authorization'
import { PodToolBroker } from '../src/main/broker/tools'
import { AuthorityError, InfrastructureError } from '../src/contracts/infrastructure'
import type { RunApproval } from '../src/contracts/activity'
import { callEffect } from '../src/main/programs/session'

// A faithful fake of the IdP's per-call program authorization (issue 1473, revision 4; IdP PR 417):
// POST /api/grants/authorize answers 200 with a command token, 202 with a pending request or 403 with the refusal.
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })

type Decision = 'approved' | 'pending' | 'denied' | 'revoked'
interface Tamper { sub?: string, target_host?: string, argv_hash?: string, program_sha256?: string, iss?: string, foreignKey?: true, grant_id?: string, brokered?: unknown }
const allowedFields = ['target_host', 'audience', 'program', 'argv', 'grant_type', 'summary', 'batch']

async function idp() {
  const podId = randomUUID()
  const keys = generateKeyPairSync('ed25519'); const foreign = generateKeyPairSync('ed25519')
  const state = {
    authorizations: [] as Record<string, unknown>[], reads: 0, keySets: 0, consumes: [] as string[], approvals: [] as string[],
    // What the IdP decides for a command: the newest grant of this requester per argv hash.
    grants: new Map<string, { id: string, status: string }>(),
    initial: 'approved' as Decision,
    // The IdP's resolution of exactly this call, which the command token carries (IdP PR 417): action per argv.
    resolve: (_argv: string[]) => ['read'],
    // The covering grant: a whole-program grant over reads and writes, which never decides the classification.
    grantActions: ['read', 'edit'], grantType: 'always', lifetime: 300, tamper: {} as Tamper, unavailable: 0,
  }
  let origin = ''
  const token = async (grantId: string, body: { program: { name: string, sha256: string }, argv: string[] }) => {
    const now = Math.floor(Date.now() / 1000)
    const argv = [body.program.name, ...body.argv]
    const claims = { iss: state.tamper.iss ?? origin, sub: state.tamper.sub ?? 'pod@example.test', aud: 'shapes', target_host: state.tamper.target_host ?? `pods:${podId}`, iat: now, exp: now + state.lifetime, jti: randomUUID(), grant_id: state.tamper.grant_id ?? grantId, grant_type: state.grantType, approval: state.grantType, authorization_details: state.resolve(body.argv).map(action => ({ type: 'openape_cli', cli_id: body.program.name, operation_id: 'fixture', resource_chain: [], action, permission: `${body.program.name}.fixture#${action}`, display: 'Fixture command', risk: 'low' })), command: argv, argv_hash: state.tamper.argv_hash ?? await computeArgvHash(argv), program_sha256: state.tamper.program_sha256 ?? body.program.sha256, decided_by: 'owner@example.test', ...(state.tamper.brokered ? { brokered: state.tamper.brokered } : {}) }
    const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'key' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
    return `${head}.${payload}.${sign(null, Buffer.from(`${head}.${payload}`), (state.tamper.foreignKey ? foreign : keys).privateKey).toString('base64url')}`
  }
  const server = createServer(async (request, response) => {
    const reply = (status: number, body: unknown, type = 'application/json') => { response.statusCode = status; response.setHeader('Content-Type', type); response.end(JSON.stringify(body)) }
    if (request.url === '/.well-known/jwks.json') { state.keySets++; reply(200, { keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'key', alg: 'EdDSA', use: 'sig' }] }); return }
    if (request.headers.authorization !== 'Bearer SYNTHETIC_POD_TOKEN' && !request.url?.endsWith('/consume')) { reply(401, { statusCode: 401, data: { title: 'Unauthorized' } }); return }
    if (request.url?.includes('/approve')) { state.approvals.push(request.url); reply(500, {}); return }
    if (request.url === '/api/grants/authorize' && request.method === 'POST') {
      let text = ''; for await (const chunk of request) text += chunk
      const body = JSON.parse(text)
      state.authorizations.push(body)
      if (state.unavailable) { response.setHeader('Retry-After', '1'); reply(state.unavailable, { statusCode: state.unavailable, data: { type: 'https://openape.org/errors/rate_limited', title: 'Too many requests' } }); return }
      if (Object.keys(body).some(key => !allowedFields.includes(key))) { reply(400, { statusCode: 400, data: { title: 'Unknown field' } }); return }
      const key = await computeArgvHash([body.program.name, ...body.argv])
      const grant = state.grants.get(key) ?? { id: `grant-${state.grants.size + 1}`, status: state.initial }
      state.grants.set(key, grant)
      if (grant.status === 'approved') { reply(200, { state: 'approved', grant_id: grant.id, authz_jwt: await token(grant.id, body), expires_at: Math.floor(Date.now() / 1000) + state.lifetime }); return }
      if (grant.status === 'pending') { reply(202, { state: 'pending', grant_id: grant.id, approval_url: `${origin}/grant-approval?grant_id=${grant.id}` }); return }
      reply(403, { type: `https://openape.org/errors/grant_${grant.status}`, title: `Grant ${grant.status}`, status: 403, state: grant.status, grant_id: grant.id }, 'application/problem+json'); return
    }
    if (request.url?.endsWith('/consume')) { state.consumes.push(request.url.split('/')[3]!); reply(200, { status: 'consumed' }); return }
    if (request.method === 'GET' && request.url?.startsWith('/api/grants/')) {
      state.reads++
      const id = request.url.split('/')[3]
      const grant = [...state.grants.values()].find(item => item.id === id)
      reply(200, { id, status: grant?.status, created_at: Math.floor(Date.now() / 1000), request: { requester: 'pod@example.test', audience: 'shapes', target_host: `pods:${podId}`, grant_type: 'always', summary: { title: 'Read the pull request' }, authorization_details: [{ type: 'openape_cli', cli_id: 'gh', operation_id: 'pr.view', resource_chain: [], action: 'read', permission: 'gh.repo[name=x]#read', display: 'View a pull request', risk: 'low' }] } })
      return
    }
    reply(404, {})
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture address')
  origin = `http://127.0.0.1:${address.port}`
  const connection = { issuer: origin, subject: 'pod@example.test', owner: 'owner@example.test', keyId: 'key', targetHost: `pods:${podId}`, accessToken: async () => 'SYNTHETIC_POD_TOKEN' }
  const progress: RunApproval[] = []; const recorded: Grant[] = []
  // Program calls never look up the grant ledger: grants recorded before (any adapter digest) cause no new request.
  const lookups: string[] = []
  const ledger = { find: async () => { lookups.push('find'); return undefined }, adopt: async () => { lookups.push('adopt'); return undefined }, record: async (grant: Grant) => { recorded.push(grant) } }
  const authority = (tokens?: RunGrantTokens) => new AgentAuthority(connection, async (item) => { progress.push(item) }, ledger, tokens, { origin: 'Rebase Pod', summary: { title: 'Read the pull request' } })
  return { state, connection, authority, progress, recorded, origin, lookups }
}

const sha = 'a'.repeat(64)
const call = (argv = ['pr', 'view', '7', '--json', 'state']): ProgramCall => ({ program: { name: 'gh', sha256: sha }, argv })
const signal = () => new AbortController().signal

it('sends the exact command and program hash and runs an approved call only with a verified token', async () => {
  const f = await idp()
  const authorization = await f.authority().authorizeProgram(call(), signal())
  expect(authorization).toEqual({ grantId: 'grant-1', actions: ['read'], programs: ['gh'] })
  expect(f.state.authorizations).toEqual([{ target_host: f.connection.targetHost, audience: 'shapes', program: { name: 'gh', sha256: sha }, argv: ['pr', 'view', '7', '--json', 'state'], grant_type: 'always', summary: { title: 'Read the pull request', origin: 'Rebase Pod' } }])
  // Nothing about the command's meaning leaves the desktop: no permissions, details, adapter or argv hash.
  expect(Object.keys(f.state.authorizations[0]!)).not.toContain('authorization_details')
  expect(callEffect(authorization, 'gh')).toEqual({ write: false })
  expect(f.state.approvals).toEqual([]); expect(f.progress).toEqual([]); expect(f.lookups).toEqual([])
})

it('asks the IdP exactly once per uncached call and reuses the token for identical commands', async () => {
  const f = await idp(); const tokens = new RunGrantTokens()
  for (let index = 0; index < 5; index++) await f.authority(tokens).authorizeProgram(call(), signal())
  expect(f.state.authorizations).toHaveLength(1)
  expect(f.state.keySets).toBe(1)
  // Another argv is another command: it gets its own token, and the signing keys are not fetched again.
  await f.authority(tokens).authorizeProgram(call(['pr', 'view', '8', '--json', 'state']), signal())
  expect(f.state.authorizations).toHaveLength(2); expect(f.state.keySets).toBe(1)
  // Parallel identical calls share one request.
  await Promise.all(Array.from({ length: 4 }, () => f.authority(tokens).authorizeProgram(call(['pr', 'list']), signal())))
  expect(f.state.authorizations).toHaveLength(3)
  // Without run tokens (a terminal session) every call asks again.
  await f.authority().authorizeProgram(call(), signal()); await f.authority().authorizeProgram(call(), signal())
  expect(f.state.authorizations).toHaveLength(5)
})

it('measures the local overhead of an uncached and a cached call', async () => {
  const f = await idp(); const tokens = new RunGrantTokens()
  await f.authority(tokens).authorizeProgram(call(['warm']), signal())
  const uncached: number[] = []; const cached: number[] = []
  for (let index = 0; index < 40; index++) {
    let started = performance.now(); await f.authority(tokens).authorizeProgram(call(['pr', 'view', String(index)]), signal()); uncached.push(performance.now() - started)
    started = performance.now(); await f.authority(tokens).authorizeProgram(call(['pr', 'view', String(index)]), signal()); cached.push(performance.now() - started)
  }
  const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)]!
  console.info(`program authorization overhead without network latency: uncached p95 ${p95(uncached).toFixed(2)} ms, cached p95 ${p95(cached).toFixed(2)} ms`)
  expect(f.state.authorizations).toHaveLength(41)
  expect(p95(cached)).toBeLessThan(p95(uncached))
})

it('shows a pending request, waits for the owner and authorizes the call again after approval', async () => {
  const f = await idp(); f.state.initial = 'pending'
  const work = f.authority(new RunGrantTokens()).authorizeProgram(call(), signal())
  await expect.poll(() => f.progress[0]?.state).toBe('pending')
  expect(f.progress[0]).toMatchObject({ grantId: 'grant-1', issuer: f.origin, title: 'Read the pull request', permission: 'gh.repo[name=x]#read', subject: 'pod@example.test' })
  expect(f.recorded.map(grant => grant.id)).toContain('grant-1')
  f.state.grants.get(await computeArgvHash(['gh', ...call().argv]))!.status = 'approved'
  await expect(work).resolves.toEqual({ grantId: 'grant-1', actions: ['read'], programs: ['gh'] })
  expect(f.progress.map(item => item.state)).toEqual(['pending', 'approved'])
  expect(f.state.authorizations).toHaveLength(2); expect(f.state.approvals).toEqual([]); expect(f.lookups).toEqual([])
}, 15000)

it.each(['denied', 'revoked'] as const)('fails a %s call with today\'s wording and asks nothing else', async (decision) => {
  const f = await idp(); f.state.initial = decision
  const failure = await f.authority(new RunGrantTokens()).authorizeProgram(call(), signal()).catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(AuthorityError)
  expect((failure as Error).message).toBe(`Permission ${decision}; review this Pod's permissions before retrying`)
  expect(f.state.authorizations).toHaveLength(1); expect(f.state.reads).toBe(0); expect(f.progress).toEqual([])
})

it('keeps a call blocked when the owner denies its waiting request', async () => {
  const f = await idp(); f.state.initial = 'pending'
  const work = f.authority().authorizeProgram(call(), signal())
  const refusal = expect(work).rejects.toThrow('Permission denied')
  await expect.poll(() => f.progress[0]?.state).toBe('pending')
  f.state.grants.get(await computeArgvHash(['gh', ...call().argv]))!.status = 'denied'
  await refusal
  expect(f.progress.map(item => item.state)).toEqual(['pending', 'denied'])
  expect(f.state.authorizations).toHaveLength(1)
}, 15000)

it.each<[string, Tamper]>([
  ['another argv hash', { argv_hash: `SHA-256:${'0'.repeat(64)}` }],
  ['another program hash', { program_sha256: 'b'.repeat(64) }],
  ['another subject', { sub: 'other@example.test' }],
  ['another execution target', { target_host: 'pods:other' }],
  ['a foreign issuer', { iss: 'https://foreign.example.test' }],
  ['a foreign signing key', { foreignKey: true }],
  ['another grant', { grant_id: 'grant-9' }],
  ['a foreign broker binding', { brokered: { broker: 'https://broker.example.test', owner: 'owner@example.test', agent: 'pod@example.test' } }],
])('refuses a token with %s before anything runs and never reuses it', async (_, tamper) => {
  const f = await idp(); f.state.tamper = tamper
  const tokens = new RunGrantTokens()
  await expect(f.authority(tokens).authorizeProgram(call(), signal())).rejects.toThrow(new AuthorityError('The IdP command token does not match this Pod, host, command or program; nothing was run'))
  f.state.tamper = {}
  await f.authority(tokens).authorizeProgram(call(), signal())
  expect(f.state.authorizations).toHaveLength(2)
})

it('consumes a single-use grant\'s token for exactly one call', async () => {
  const f = await idp(); f.state.grantType = 'once'
  const tokens = new RunGrantTokens()
  await f.authority(tokens).authorizeProgram(call(), signal())
  await f.authority(tokens).authorizeProgram(call(), signal())
  expect(f.state.consumes).toEqual(['grant-1', 'grant-1']); expect(f.state.authorizations).toHaveLength(2)
})

it('treats a rate limit as transient and an IdP without the endpoint as an update requirement', async () => {
  const f = await idp(); f.state.unavailable = 429
  await expect(f.authority().authorizeProgram(call(), signal())).rejects.toBeInstanceOf(InfrastructureError)
  f.state.unavailable = 404
  await expect(f.authority().authorizeProgram(call(), signal())).rejects.toThrow('does not authorize program calls yet')
})

// The coordinator's rule (issue 1473): classify by the IdP's resolution of the call, never by the covering grant.
it('classifies a call by the IdP resolution in its token even when a mixed whole-program grant covers it', async () => {
  const f = await idp(); const tokens = new RunGrantTokens()
  f.state.resolve = argv => [argv[1] === 'merge' ? 'edit' : 'read']
  expect(f.state.grantActions).toEqual(['read', 'edit'])
  const read = await f.authority(tokens).authorizeProgram(call(['pr', 'view', '7']), signal())
  expect(read.actions).toEqual(['read']); expect(callEffect(read, 'gh')).toEqual({ write: false })
  const write = await f.authority(tokens).authorizeProgram(call(['pr', 'merge', '7']), signal())
  expect(write.actions).toEqual(['edit']); expect(callEffect(write, 'gh')).toEqual({ write: true })
  // A program the registry does not describe resolves to the generic exact-command detail: an effect.
  f.state.resolve = () => ['exec']
  expect(callEffect(await f.authority(tokens).authorizeProgram(call(['unknown']), signal()), 'gh')).toEqual({ write: true })
})

it('classifies writes and keeps mail moves in the archive port from the resolved actions', () => {
  const resolved = (actions: string[], programs = ['gh']) => ({ grantId: 'g', actions, programs })
  expect(callEffect(resolved(['read', 'list']), 'gh')).toEqual({ write: false })
  expect(callEffect(resolved(['read', 'push']), 'gh')).toEqual({ write: true })
  expect(callEffect(resolved([]), 'gh')).toEqual({ write: true })
  // An exact-command fallback of an ordinary program runs as an effect.
  expect(callEffect(resolved(['exec']), 'git')).toEqual({ write: true })
  expect(() => callEffect(resolved(['move']), 'gh')).toThrow('approved archive service')
  expect(callEffect(resolved(['move'], ['o365']), 'o365-cli', 'move')).toEqual({ write: true })
  expect(() => callEffect(resolved(['read'], ['o365']), 'o365-cli', 'move')).toThrow('only run the granted move')
})

// Review finding (issue 1473): the archive gate fails closed for mail programs whatever the IdP could resolve.
it('refuses every action of a mail program outside its archive port except known non-moving ones', () => {
  const resolved = (actions: string[], programs: string[]) => ({ grantId: 'g', actions, programs })
  // An exact-command fallback of `workflow move` (no shape for this file) outside the port: refused.
  for (const action of ['exec', '*', 'unknown', 'move', 'archive']) expect(() => callEffect(resolved([action], ['o365-cli']), 'o365-cli'), action).toThrow('approved archive service')
  expect(() => callEffect(resolved([], []), 'pods-mail')).toThrow('approved archive service')
  // Matched by the resolved program as well, whatever the assigned file is called.
  expect(() => callEffect(resolved(['exec'], ['o365']), 'outlook-tool')).toThrow('approved archive service')
  // Known non-moving effects and reads stay allowed.
  expect(callEffect(resolved(['categorize'], ['o365']), 'o365-cli')).toEqual({ write: true })
  expect(callEffect(resolved(['configure'], ['o365']), 'o365-cli')).toEqual({ write: true })
  expect(callEffect(resolved(['read', 'list'], ['pods-mail']), 'pods-mail')).toEqual({ write: false })
  // The move itself runs only through the port.
  expect(callEffect(resolved(['move'], ['o365']), 'o365-cli', 'move')).toEqual({ write: true })
})

it('refuses a changed program file and a tampered token before anything starts', async () => {
  const f = await idp()
  const root = await mkdtemp(join(tmpdir(), 'pods-program-call-')); cleanup.push(() => rm(root, { recursive: true, force: true }))
  const program = join(root, 'gh'); await writeFile(program, '#!/bin/sh\necho synthetic\n'); await chmod(program, 0o700)
  const hash = createHash('sha256').update('#!/bin/sh\necho synthetic\n').digest('hex')
  const asked: ProgramCall[] = []
  const authority = f.authority()
  // The helper does not exist: reaching the launch would fail differently than the refusals below.
  const broker = new PodToolBroker(join(root, 'missing-helper'), join(root, 'runs'), async (requested, callSignal) => { asked.push(requested); callEffect(await authority.authorizeProgram(requested, callSignal), requested.program.name) }, undefined as never)
  const lease = { capabilities: ['tool.app.invoke'], assertCurrent: () => {}, signal: signal() }
  const assignment = { id: 'app', capability: 'tool.app.invoke', program: { path: program, name: 'gh', sha256: hash }, argv: ['pr', 'list'], executable: program, executableHash: hash, entryFiles: [], prefix: [], runtimeDirectories: [], environment: {}, networkPorts: [] }
  f.state.tamper = { program_sha256: 'c'.repeat(64) }
  await expect(broker.execute(assignment, { toolId: 'app', argv: ['pr', 'list'] }, lease)).rejects.toBeInstanceOf(AuthorityError)
  expect(asked).toEqual([{ program: { name: 'gh', sha256: hash }, argv: ['pr', 'list'] }])
  await writeFile(program, '#!/bin/sh\necho changed\n')
  await expect(broker.execute(assignment, { toolId: 'app', argv: ['pr', 'list'] }, lease)).rejects.toThrow()
  // The changed file is refused before the IdP is asked.
  expect(asked).toHaveLength(1); expect(f.state.authorizations).toHaveLength(1)
  await expect(broker.execute(assignment, { toolId: 'app', argv: ['pr', 'view'] }, lease)).rejects.toThrow('outside the assigned tool call')
})
