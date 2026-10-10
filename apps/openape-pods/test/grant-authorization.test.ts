// @vitest-environment node
import { createServer } from 'node:http'
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { loadAdapter, resolveCommand } from '@openape/apes'
import { AgentAuthority, decisionPollMs, grantTokenReuseMs, RunGrantTokens } from '../src/main/broker/authorization'
import { AuthorityError, InfrastructureError, retryInfrastructure } from '../src/contracts/infrastructure'
import type { RunApproval } from '../src/contracts/activity'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { vi.useRealTimers(); for (const close of cleanup.splice(0)) await close() })
async function fixture(initial = 'used', decision = 'approved') {
  const podId = randomUUID()
  const adapterPath = resolve('runtime-sources/pod-runtime-shapes.toml')
  const adapter = loadAdapter('pod-runtime', adapterPath)
  const argv = ['pod-runtime', 'run', '--pod', podId, '--name', 'Synthetic Pod', '--script', '/fixture/run.mjs', '--workspace', '/fixture/workspace', '--environment', JSON.stringify({ HOME: '/fixture/home' })]
  const resolved = await resolveCommand(adapter, argv)
  const command = { cliId: 'pod-runtime', adapterPath, adapterDigest: adapter.digest, argv, coverage: [resolved.detail] }
  const keys = generateKeyPairSync('ed25519')
  const state = { checks: 0, lifetime: 60, unavailablePath: '', unavailable: 0, grantType: 'once', initial, decision, creates: 0, consumes: [] as string[], tokens: [] as string[], bodies: [] as Record<string, unknown>[], active: true, tokenError: false, subject: 'pod@example.test', progress: [] as RunApproval[], grants: new Map<string, string>(), types: new Map<string, string>(), approvals: [] as string[], reads: 0, staleAdapters: new Set<string>() }
  let origin = ''
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json')
    const reply = (body: unknown) => response.end(JSON.stringify(body))
    if (state.unavailablePath && request.url?.endsWith(state.unavailablePath)) { response.statusCode = state.unavailable || 503; reply({ title: 'Temporary failure' }); return }
    if (request.url === '/.well-known/jwks.json') { reply({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'key', alg: 'EdDSA', use: 'sig' }] }); return }
    if (state.unavailable && request.method === 'GET' && request.url?.startsWith('/api/grants/')) { response.statusCode = state.unavailable; reply({ title: 'Temporary failure' }); return }
    const id = request.url?.split('/')[3] ?? ''
    // Pods never decides a grant itself: any approval call fails the test.
    if (request.url?.includes('/approve')) { state.approvals.push(request.url); response.statusCode = 500; reply({}); return }
    if (request.url?.startsWith('/api/pods/agents/')) { state.checks++; const grantId = new URL(request.url, origin).searchParams.get('grant'); reply({ email: 'pod@example.test', owner: 'owner@example.test', active: state.active, keyIds: ['key'], grantId, grantActive: true }); return }
    if (request.url === '/api/grants' && request.method === 'POST') {
      let text = ''; for await (const chunk of request) text += chunk
      const body = JSON.parse(text); state.bodies.push(body); state.creates++
      const next = `fresh-${state.creates}`; state.grants.set(next, state.decision); state.types.set(next, body.grant_type); reply({ id: next }); return
    }
    if (request.url?.endsWith('/token')) {
      state.tokens.push(id)
      if (state.tokenError || (id === 'old' && state.initial === 'used')) { response.statusCode = 400; reply({ type: 'https://openape.org/errors/grant_not_approved', title: 'Grant is not approved (status: used)' }); return }
      const now = Math.floor(Date.now() / 1000)
      const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'key' })).toString('base64url')
      const payload = Buffer.from(JSON.stringify({ iss: origin, sub: state.subject, aud: 'shapes', target_host: `pods:${podId}`, grant_id: id, grant_type: state.grantType, iat: now, exp: now + state.lifetime, jti: randomUUID(), authorization_details: [resolved.detail], execution_context: state.staleAdapters.has(id) ? { ...resolved.executionContext, adapter_digest: `SHA-256:${'0'.repeat(64)}` } : resolved.executionContext })).toString('base64url')
      reply({ authz_jwt: `${head}.${payload}.${sign(null, Buffer.from(`${head}.${payload}`), keys.privateKey).toString('base64url')}` }); return
    }
    if (request.url?.endsWith('/consume')) { state.consumes.push(id); if (state.grantType === 'once') state.grants.set(id, 'used'); reply({ status: 'valid' }); return }
    if (request.method === 'GET' && request.url?.startsWith('/api/grants/')) { state.reads++; reply({ id, status: id === 'old' ? state.initial : state.grants.get(id), request: { requester: 'pod@example.test', audience: 'shapes', target_host: `pods:${podId}`, grant_type: state.types.get(id) ?? 'once', authorization_details: [resolved.detail] } }); return }
    response.statusCode = 404; reply({})
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture address')
  origin = `http://127.0.0.1:${address.port}`
  const connection = { issuer: origin, subject: 'pod@example.test', owner: 'owner@example.test', keyId: 'key', targetHost: `pods:${podId}`, accessToken: async () => 'SYNTHETIC_POD_TOKEN' }
  const authority = new AgentAuthority(connection, async (progress) => { state.progress.push(progress) })
  return { state, authority, command, connection, resolved }
}

it('renews consumed once grants and verifies/consumes two independently authorized runs', async () => {
  const f = await fixture()
  const assignment = { command: f.command, grantId: 'old' }
  await f.authority.authorize(assignment, new AbortController().signal)
  await f.authority.authorize(assignment, new AbortController().signal)
  expect(f.state.creates).toBe(2)
  expect(f.state.tokens).toEqual(['fresh-1', 'fresh-2'])
  expect(f.state.consumes).toEqual(['fresh-1', 'fresh-2'])
  expect(f.state.bodies[0]).toMatchObject({ permissions: [f.resolved.permission], target_host: f.connection.targetHost, grant_type: 'always' })
  // A continuing request waits for the owner's decision instead of a caller deadline.
  expect(f.state.bodies[0]).not.toHaveProperty('waits_until')
  expect(f.resolved.executionContext.context_bindings).toMatchObject({ name: 'Synthetic Pod', script: '/fixture/run.mjs', environment: '{"HOME":"/fixture/home"}' })
})
// Owner decision October 10, 2026 (issue 1455): a program or HTTP command without a recorded grant asks for a
// continuing grant like the runtime; single-use approvals remain only for gate batches.
it('requests a continuing grant for a program command that has no recorded grant', async () => {
  const f = await fixture('used', 'pending')
  const adapterPath = resolve('runtime-sources/pod-http-shapes.toml'); const adapter = loadAdapter('pod-http', adapterPath)
  const argv = ['pod-http', 'request', '--origin', 'https://api.example.test', '--method', 'GET']
  const resolved = await resolveCommand(adapter, argv)
  const controller = new AbortController()
  const work = f.authority.authorize({ command: { cliId: 'pod-http', adapterPath, adapterDigest: adapter.digest, argv, coverage: [resolved.detail] }, grantId: '' }, controller.signal)
  const cancelled = expect(work).rejects.toThrow()
  await expect.poll(() => f.state.creates).toBe(1)
  expect(f.state.bodies[0]).toMatchObject({ grant_type: 'always', permissions: [resolved.permission] })
  expect(f.state.bodies[0]).not.toHaveProperty('waits_until')
  controller.abort(); await cancelled
})
it('shows a pending approval and resumes only after its decision', async () => {
  const f = await fixture('used', 'pending')
  const work = f.authority.authorize({ command: f.command, grantId: 'old' }, new AbortController().signal)
  await expect.poll(() => f.state.progress[0]?.state).toBe('pending')
  expect(f.state.tokens).toEqual([])
  f.state.grants.set('fresh-1', 'approved'); await work
  expect(f.state.progress.map(item => item.state)).toEqual(['pending', 'approved'])
  expect(f.state.consumes).toEqual(['fresh-1'])
})
it.each(['denied', 'revoked'])('does not recreate a %s permission or consume a token', async (decision) => {
  const f = await fixture(decision)
  await expect(f.authority.authorize({ command: f.command, grantId: 'old' }, new AbortController().signal)).rejects.toThrow(decision)
  expect(f.state.creates).toBe(0); expect(f.state.consumes).toEqual([])
})
it('cancels an approval wait without consuming or approving anything', async () => {
  const f = await fixture('used', 'pending'); const controller = new AbortController()
  const work = f.authority.authorize({ command: f.command, grantId: 'old' }, controller.signal)
  const rejection = expect(work).rejects.toThrow()
  await expect.poll(() => f.state.progress[0]?.state).toBe('pending')
  controller.abort(); await rejection
  expect(f.state.progress.at(-1)?.state).toBe('cancelled'); expect(f.state.consumes).toEqual([])
})
it('fails closed for a foreign signed identity and a no-longer-approved token race', async () => {
  const f = await fixture('approved'); f.state.subject = 'other@example.test'
  await expect(f.authority.authorize({ command: f.command, grantId: 'old' }, new AbortController().signal)).rejects.toThrow('assigned identity')
  expect(f.state.consumes).toEqual([])
  f.state.tokenError = true
  await expect(f.authority.authorize({ command: f.command, grantId: 'old' }, new AbortController().signal)).rejects.toThrow('no longer approved')
  expect(f.state.creates).toBe(0)
})

it('reuses Pod-scoped continuing permission across script paths, but rejects another Pod', async () => {
  const f = await fixture('approved'); f.state.grantType = 'always'
  const changed = { ...f.command, argv: f.command.argv.map(arg => arg === '/fixture/run.mjs' ? '/fixture/next-run.mjs' : arg) }
  await f.authority.authorize({ command: changed, grantId: 'old' }, new AbortController().signal)
  expect(f.state.creates).toBe(0); expect(f.state.consumes).toEqual(['old'])
  const otherId = randomUUID()
  const other = { ...changed, argv: changed.argv.map(arg => arg === f.connection.targetHost.slice(5) ? otherId : arg) }
  await expect(f.authority.authorize({ command: other, grantId: 'old' }, new AbortController().signal)).rejects.toThrow('outside the assigned operation')
  expect(f.state.consumes).toEqual(['old'])
})

it('uses the current owner assignment instead of a historical grant for a replaced adapter', async () => {
  const f = await fixture('approved'); f.state.grantType = 'always'
  f.state.grants.set('historical', 'approved'); f.state.staleAdapters.add('historical')
  const authority = new AgentAuthority(f.connection, undefined, { find: async () => 'historical', adopt: async () => undefined, record: async () => {} })
  await authority.authorize({ command: f.command, grantId: 'old' }, new AbortController().signal)
  expect(f.state.tokens).toEqual(['old']); expect(f.state.consumes).toEqual(['old'])
  expect(f.state.creates).toBe(0)
})

it('retains a renewed continuing grant when the original assignment was consumed', async () => {
  const f = await fixture(); f.state.grantType = 'always'; f.state.grants.set('renewed', 'approved')
  const authority = new AgentAuthority(f.connection, undefined, { find: async () => 'renewed', adopt: async () => undefined, record: async () => {} })
  await authority.authorize({ command: f.command, grantId: 'old' }, new AbortController().signal)
  expect(f.state.tokens).toEqual(['renewed']); expect(f.state.consumes).toEqual(['renewed'])
  expect(f.state.creates).toBe(0)
})

it('requests the runtime at the IdP, waits for the owner and reuses the approved continuing grant without approving it', async () => {
  const f = await fixture('used', 'pending'); f.state.grantType = 'always'
  const progress: string[] = []
  const authority = new AgentAuthority(f.connection, async (item) => { progress.push(item.state) })
  const assignment = { command: f.command, grantId: '' }
  const work = authority.authorize(assignment, new AbortController().signal)
  await expect.poll(() => progress[0]).toBe('pending')
  expect(f.state.tokens).toEqual([])
  f.state.grants.set('fresh-1', 'approved')
  await work
  await authority.authorize(assignment, new AbortController().signal)
  expect(f.state.creates).toBe(1)
  expect(f.state.consumes).toEqual(['fresh-1', 'fresh-1'])
  expect(progress).toEqual(['pending', 'approved', 'approved'])
  expect(f.state.approvals).toEqual([])
})

it('lets parallel calls of one run share one grant request and one decision wait', async () => {
  const f = await fixture('used', 'pending'); f.state.grantType = 'always'
  const tokens = new RunGrantTokens(); const progress: string[] = []
  const calls = Array.from({ length: 5 }, () => new AgentAuthority(f.connection, async (item) => { progress.push(item.state) }, undefined, tokens).authorize({ command: f.command, grantId: '' }, new AbortController().signal))
  await expect.poll(() => progress.filter(state => state === 'pending').length).toBe(5)
  const reads = f.state.reads
  await new Promise(resolve => setTimeout(resolve, 4500))
  // One shared wait polls about every two seconds; five separate waits would read the grant about ten times.
  expect(f.state.reads - reads).toBeLessThanOrEqual(3)
  f.state.grants.set('fresh-1', 'approved'); await Promise.all(calls)
  expect(f.state.creates).toBe(1); expect(f.state.approvals).toEqual([])
}, 15000)

it('polls quickly while the owner is likely deciding and slowly during a long wait', () => {
  expect(decisionPollMs(0)).toBe(2000)
  expect(decisionPollMs(5 * 60 * 1000 - 1)).toBe(2000)
  expect(decisionPollMs(5 * 60 * 1000)).toBe(30000)
})

it.each(['denied', 'revoked'])('never replaces a previously %s runtime decision', async (decision) => {
  const f = await fixture(decision)
  const authority = new AgentAuthority(f.connection, undefined, { find: async () => 'old', adopt: async () => undefined, record: async () => {} })
  await expect(authority.authorize({ command: f.command, grantId: '' }, new AbortController().signal)).rejects.toThrow(decision)
  expect(f.state.approvals).toEqual([]); expect(f.state.creates).toBe(0)
})

it.each(['denied', 'revoked'])('keeps a run blocked when the owner %s the waiting request and mints no token', async (decision) => {
  const f = await fixture('used', 'pending')
  const work = f.authority.authorize({ command: f.command, grantId: '' }, new AbortController().signal)
  const refusal = expect(work).rejects.toBeInstanceOf(AuthorityError)
  await expect.poll(() => f.state.progress[0]?.state).toBe('pending')
  f.state.grants.set('fresh-1', decision); await refusal
  expect(f.state.progress.map(item => item.state)).toEqual(['pending', decision])
  expect(f.state.tokens).toEqual([]); expect(f.state.consumes).toEqual([]); expect(f.state.approvals).toEqual([])
})

it('classifies a permission-service outage before execution and revalidates the grant after recovery', async () => {
  const f = await fixture('approved'); f.state.grantType = 'always'; f.state.unavailable = 503
  const assignment = { command: f.command, grantId: 'old' }
  await expect(f.authority.authorize(assignment, new AbortController().signal)).rejects.toBeInstanceOf(InfrastructureError)
  expect(f.state.consumes).toEqual([])
  f.state.unavailable = 0
  await f.authority.authorize(assignment, new AbortController().signal)
  expect(f.state.consumes).toEqual(['old'])
  f.state.unavailable = 403
  await expect(f.authority.authorize(assignment, new AbortController().signal)).rejects.not.toBeInstanceOf(InfrastructureError)
  expect(f.state.consumes).toEqual(['old'])
})

it.each(['/.well-known/jwks.json', '/consume'])('recovers a permission outage at %s before any operation executes', async (path) => {
  const f = await fixture('approved')
  f.state.grantType = 'always'
  f.state.unavailablePath = path
  const assignment = { grantId: 'old', command: f.command }
  await expect(f.authority.authorize(assignment, new AbortController().signal)).rejects.toBeInstanceOf(InfrastructureError)
  expect(f.state.consumes).toEqual([])
  f.state.unavailablePath = ''
  await f.authority.authorize(assignment, new AbortController().signal)
  expect(f.state.consumes).toEqual(['old'])
})

it.each([408, 429, 500, 502, 503, 504])('retries grant creation after HTTP %s without approving or executing during the outage', async (status) => {
  const f = await fixture('used', 'pending')
  f.state.grantType = 'always'
  f.state.unavailablePath = '/api/grants'; f.state.unavailable = status
  const assignment = { grantId: '', command: f.command }
  await expect(f.authority.authorize(assignment, new AbortController().signal)).rejects.toBeInstanceOf(InfrastructureError)
  expect(f.state.creates).toBe(0); expect(f.state.tokens).toEqual([]); expect(f.state.consumes).toEqual([])
  f.state.unavailablePath = ''; f.state.unavailable = 0
  const work = f.authority.authorize(assignment, new AbortController().signal)
  await expect.poll(() => f.state.progress[0]?.state).toBe('pending')
  expect(f.state.consumes).toEqual([])
  f.state.grants.set('fresh-1', 'approved')
  await work
  expect(f.state.creates).toBe(1); expect(f.state.consumes).toEqual(['fresh-1'])
})

it.each([400, 401, 403, 409])('does not retry grant creation refused with HTTP %s', async (status) => {
  const f = await fixture()
  f.state.unavailablePath = '/api/grants'; f.state.unavailable = status
  await expect(f.authority.authorize({ grantId: '', command: f.command }, new AbortController().signal)).rejects.not.toBeInstanceOf(InfrastructureError)
  expect(f.state.creates).toBe(0); expect(f.state.consumes).toEqual([])
})

it('automatically resumes runtime authorization after grant creation recovers', async () => {
  const f = await fixture('used', 'pending'); f.state.grantType = 'always'
  f.state.unavailablePath = '/api/grants'
  const notice = vi.fn(async () => { f.state.unavailablePath = '' })
  const controller = new AbortController()
  const work = retryInfrastructure(() => f.authority.authorize({ grantId: '', command: f.command }, controller.signal), controller.signal, notice)
  await expect.poll(() => f.state.progress[0]?.state, { timeout: 4000 }).toBe('pending')
  expect(notice).toHaveBeenCalledWith({ attempt: 1, nextAt: expect.any(Number), error: 'Permission service temporarily unavailable' })
  expect(f.state.consumes).toEqual([])
  f.state.grants.set('fresh-1', 'approved')
  await work
  expect(notice).toHaveBeenLastCalledWith(null)
  expect(f.state.creates).toBe(1); expect(f.state.consumes).toEqual(['fresh-1'])
})

const signal = () => new AbortController().signal
const runAuthority = (f: Awaited<ReturnType<typeof fixture>>) => new AgentAuthority(f.connection, undefined, undefined, new RunGrantTokens())

it('checks the grant and owner once per run and re-verifies the token locally for later calls', async () => {
  const f = await fixture('approved'); f.state.grantType = 'always'; f.state.lifetime = 3600
  const run = runAuthority(f)
  for (let call = 0; call < 3; call++) await run.authorize({ command: f.command, grantId: 'old' }, signal())
  expect({ tokens: f.state.tokens, consumes: f.state.consumes, checks: f.state.checks }).toEqual({ tokens: ['old'], consumes: ['old'], checks: 1 })
  await runAuthority(f).authorize({ command: f.command, grantId: 'old' }, signal())
  expect({ tokens: f.state.tokens, checks: f.state.checks }).toEqual({ tokens: ['old', 'old'], checks: 2 })
})

it('refuses the next run after the owner revokes the grant and mints no token for it', async () => {
  const f = await fixture('approved'); f.state.grantType = 'always'; f.state.lifetime = 3600
  await runAuthority(f).authorize({ command: f.command, grantId: 'old' }, signal())
  f.state.initial = 'revoked'
  await expect(runAuthority(f).authorize({ command: f.command, grantId: 'old' }, signal())).rejects.toThrow('revoked')
  expect(f.state.tokens).toEqual(['old']); expect(f.state.consumes).toEqual(['old']); expect(f.state.creates).toBe(0)
})

it('reuses a token for at most 60 seconds even when it is valid much longer, then refuses a revoked grant', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const f = await fixture('approved'); f.state.grantType = 'timed'; f.state.lifetime = 24 * 3600
  const run = runAuthority(f)
  await run.authorize({ command: f.command, grantId: 'old' }, signal())
  f.state.initial = 'revoked'
  vi.setSystemTime(Date.now() + grantTokenReuseMs - 1000)
  await run.authorize({ command: f.command, grantId: 'old' }, signal())
  vi.setSystemTime(Date.now() + 2000)
  await expect(run.authorize({ command: f.command, grantId: 'old' }, signal())).rejects.toThrow('revoked')
  expect(f.state.tokens).toEqual(['old']); expect(f.state.checks).toBe(1)
  expect(grantTokenReuseMs).toBe(60 * 1000)
})

it('never reuses a single-use grant token within a run', async () => {
  const f = await fixture(); f.state.lifetime = 3600
  const run = runAuthority(f)
  await run.authorize({ command: f.command, grantId: 'old' }, signal())
  await run.authorize({ command: f.command, grantId: 'old' }, signal())
  expect(f.state.creates).toBe(2); expect(f.state.consumes).toEqual(['fresh-1', 'fresh-2'])
})

it('rejects a reused token for another Pod without contacting the identity service', async () => {
  const f = await fixture('approved'); f.state.grantType = 'always'; f.state.lifetime = 3600
  const run = runAuthority(f)
  await run.authorize({ command: f.command, grantId: 'old' }, signal())
  const otherId = randomUUID()
  const other = { ...f.command, argv: f.command.argv.map(arg => arg === f.connection.targetHost.slice(5) ? otherId : arg) }
  await expect(run.authorize({ command: other, grantId: 'old' }, signal())).rejects.toThrow()
  expect(f.state.tokens).toEqual(['old']); expect(f.state.consumes).toEqual(['old'])
})

it('refreshes a runtime grant mid-run only while it stays approved and never creates or approves a replacement', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const f = await fixture('used', 'approved'); f.state.grantType = 'always'; f.state.lifetime = 3600
  const run = new AgentAuthority(f.connection, undefined, { find: async () => undefined, adopt: async () => undefined, record: async () => {} }, new RunGrantTokens())
  const assignment = { command: f.command, grantId: '' }
  await run.authorize(assignment, signal())
  expect(assignment.grantId).toBe('fresh-1'); expect(f.state.creates).toBe(1)
  vi.setSystemTime(Date.now() + grantTokenReuseMs + 1000)
  await run.refresh(assignment, signal())
  expect(f.state.tokens).toEqual(['fresh-1', 'fresh-1']); expect(f.state.checks).toBe(2)
  f.state.grants.set('fresh-1', 'expired')
  vi.setSystemTime(Date.now() + grantTokenReuseMs + 1000)
  await expect(run.refresh(assignment, signal())).rejects.toThrow(AuthorityError)
  expect(f.state.creates).toBe(1); expect(f.state.approvals).toEqual([]); expect(f.state.tokens).toHaveLength(2)
})

it('never lets a second application run on the token of another application with the same permission', async () => {
  const f = await fixture('approved'); f.state.grantType = 'always'; f.state.lifetime = 3600
  f.state.grants.set('other-app', 'denied')
  const run = runAuthority(f)
  await run.authorize({ command: f.command, grantId: 'old' }, signal())
  await expect(run.authorize({ command: f.command, grantId: 'other-app' }, signal())).rejects.toThrow('denied')
  expect(f.state.tokens).toEqual(['old']); expect(f.state.consumes).toEqual(['old'])
})
