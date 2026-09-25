// @vitest-environment node
import { createServer } from 'node:http'
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { loadAdapter, resolveCommand } from '@openape/apes'
import { AgentAuthority } from '../src/main/broker/authorization'
import type { RunApproval } from '../src/contracts/activity'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })
async function fixture(initial = 'used', decision = 'approved') {
  const podId = randomUUID()
  const adapterPath = resolve('runtime-sources/pod-runtime-shapes.toml')
  const adapter = loadAdapter('pod-runtime', adapterPath)
  const argv = ['pod-runtime', 'run', '--pod', podId, '--name', 'Synthetic Pod', '--script', '/fixture/run.mjs', '--workspace', '/fixture/workspace', '--environment', JSON.stringify({ HOME: '/fixture/home' })]
  const resolved = await resolveCommand(adapter, argv)
  const command = { cliId: 'pod-runtime', adapterPath, adapterDigest: adapter.digest, argv, permission: resolved.permission }
  const keys = generateKeyPairSync('ed25519')
  const state = { grantType: 'once', initial, decision, creates: 0, consumes: [] as string[], tokens: [] as string[], bodies: [] as Record<string, unknown>[], active: true, tokenError: false, subject: 'pod@example.test', progress: [] as RunApproval[], grants: new Map<string, string>(), staleAdapters: new Set<string>() }
  let origin = ''
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json')
    const reply = (body: unknown) => response.end(JSON.stringify(body))
    if (request.url === '/.well-known/jwks.json') { reply({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'key', alg: 'EdDSA', use: 'sig' }] }); return }
    const id = request.url?.split('/')[3] ?? ''
    if (request.url?.startsWith('/api/pods/agents/')) { const grantId = new URL(request.url, origin).searchParams.get('grant'); reply({ email: 'pod@example.test', owner: 'owner@example.test', active: state.active, keyIds: ['key'], grantId, grantActive: true }); return }
    if (request.url === '/api/grants' && request.method === 'POST') {
      let text = ''; for await (const chunk of request) text += chunk
      state.bodies.push(JSON.parse(text)); state.creates++
      const next = `fresh-${state.creates}`; state.grants.set(next, state.decision); reply({ id: next }); return
    }
    if (request.url?.endsWith('/token')) {
      state.tokens.push(id)
      if (state.tokenError || (id === 'old' && state.initial === 'used')) { response.statusCode = 400; reply({ type: 'https://openape.org/errors/grant_not_approved', title: 'Grant is not approved (status: used)' }); return }
      const now = Math.floor(Date.now() / 1000)
      const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'key' })).toString('base64url')
      const payload = Buffer.from(JSON.stringify({ iss: origin, sub: state.subject, aud: 'shapes', target_host: `pods:${podId}`, grant_id: id, grant_type: state.grantType, iat: now, exp: now + 60, jti: randomUUID(), authorization_details: [resolved.detail], execution_context: state.staleAdapters.has(id) ? { ...resolved.executionContext, adapter_digest: `SHA-256:${'0'.repeat(64)}` } : resolved.executionContext })).toString('base64url')
      reply({ authz_jwt: `${head}.${payload}.${sign(null, Buffer.from(`${head}.${payload}`), keys.privateKey).toString('base64url')}` }); return
    }
    if (request.url?.endsWith('/consume')) { state.consumes.push(id); if (state.grantType === 'once') state.grants.set(id, 'used'); reply({ status: 'valid' }); return }
    if (request.method === 'GET' && request.url?.startsWith('/api/grants/')) { reply({ id, status: id === 'old' ? state.initial : state.grants.get(id), request: { requester: 'pod@example.test', audience: 'shapes', target_host: `pods:${podId}`, grant_type: 'once' } }); return }
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
  expect(f.state.bodies[0]).toMatchObject({ permissions: [f.command.permission], target_host: f.connection.targetHost, waits_until: expect.any(Number) })
  expect(f.resolved.executionContext.context_bindings).toMatchObject({ name: 'Synthetic Pod', script: '/fixture/run.mjs', environment: '{"HOME":"/fixture/home"}' })
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
  const other = { ...changed, argv: changed.argv.map(arg => arg === f.connection.targetHost.slice(5) ? otherId : arg), permission: `pod-runtime.pod[id=${otherId}]#run` }
  await expect(f.authority.authorize({ command: other, grantId: 'old' }, new AbortController().signal)).rejects.toThrow('does not cover')
  expect(f.state.consumes).toEqual(['old'])
})

it('uses the current owner assignment instead of a historical grant for a replaced adapter', async () => {
  const f = await fixture('approved'); f.state.grantType = 'always'
  f.state.grants.set('historical', 'approved'); f.state.staleAdapters.add('historical')
  const authority = new AgentAuthority(f.connection, undefined, async () => 'historical')
  await authority.authorize({ command: f.command, grantId: 'old' }, new AbortController().signal)
  expect(f.state.tokens).toEqual(['old']); expect(f.state.consumes).toEqual(['old'])
  expect(f.state.creates).toBe(0)
})

it('retains a renewed continuing grant when the original assignment was consumed', async () => {
  const f = await fixture(); f.state.grantType = 'always'; f.state.grants.set('renewed', 'approved')
  const authority = new AgentAuthority(f.connection, undefined, async () => 'renewed')
  await authority.authorize({ command: f.command, grantId: 'old' }, new AbortController().signal)
  expect(f.state.tokens).toEqual(['renewed']); expect(f.state.consumes).toEqual(['renewed'])
  expect(f.state.creates).toBe(0)
})
