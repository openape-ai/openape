// @vitest-environment node
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CredentialCache } from '../src/main/connections/cache'
import { PodIdentityManager } from '../src/main/connections/agent'

let server: Server | undefined
let root = ''
afterEach(async () => { if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); server = undefined; if (root) await rm(root, { recursive: true, force: true }) })
async function setup() {
  root = await mkdtemp(join(tmpdir(), 'pods-agent-'))
  const cache = new CredentialCache(root, { available: () => true, encrypt: value => Buffer.from(value, 'utf8').reverse(), decrypt: value => Buffer.from(value).reverse().toString() })
  const identity = new PodIdentityManager(cache)
  const state = { key: '', podId: '', challenges: 0, authenticated: 0, denied: false }
  server = createServer(async (request, response) => {
    let data = ''; for await (const chunk of request) data += String(chunk)
    const body = JSON.parse(data) as Record<string, string>
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/api/pods/agents') {
      expect(request.headers.authorization).toBe('Bearer SYNTHETIC_OWNER')
      expect(Object.keys(body).sort()).toEqual(['name', 'podId', 'publicKey'])
      state.key = body.publicKey!; state.podId = body.podId!
      const keyId = createHash('sha256').update(Buffer.from(state.key.split(' ')[1]!, 'base64')).digest('hex')
      response.end(JSON.stringify({ email: 'pod@example.test', owner: 'owner@example.test', keyId, permissions: 'none' })); return
    }
    if (state.denied) { response.statusCode = 403; response.end('{}'); return }
    if (request.url === '/api/auth/challenge') { expect(body.id).toBe('pod@example.test'); state.challenges++; response.end(JSON.stringify({ challenge: 'synthetic-challenge' })); return }
    if (request.url === '/api/auth/authenticate') {
      const wire = Buffer.from(state.key.split(' ')[1]!, 'base64')
      const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: wire.subarray(19).toString('base64url') }, format: 'jwk' })
      expect(verify(null, Buffer.from(body.challenge!), key, Buffer.from(body.signature!, 'base64'))).toBe(true)
      expect(body.id).toBe('pod@example.test'); expect(body.public_key).toBe(state.key)
      state.authenticated++; response.end(JSON.stringify({ email: body.id, act: 'agent', token: `SYNTHETIC_POD_TOKEN_${state.authenticated}`, expires_in: 3600 })); return
    }
    response.statusCode = 404; response.end('{}')
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const issuer = `http://127.0.0.1:${address.port}`
  const connectionId = randomUUID(); const podId = randomUUID()
  await identity.prepare(connectionId, podId, issuer, 'owner@example.test')
  return { identity, cache, state, connectionId, podId, issuer }
}
describe('pod identity credential isolation', () => {
  it('persists a unique key before provisioning and refreshes only that agent through signed challenges', async () => {
    const fixture = await setup()
    await expect(fixture.identity.prepare(fixture.connectionId, fixture.podId, fixture.issuer, 'owner@example.test')).rejects.toThrow('already exists')
    const reference = await fixture.identity.provision(fixture.connectionId, 'Fixture', 'SYNTHETIC_OWNER')
    const connection = fixture.identity.connection(reference, 'fixture-mac')
    expect(await connection.accessToken()).toBe('SYNTHETIC_POD_TOKEN_1')
    expect(await connection.accessToken()).toBe('SYNTHETIC_POD_TOKEN_1')
    expect(fixture.state.authenticated).toBe(1)
    await fixture.cache.withCache(fixture.connectionId, async (file) => { const value = JSON.parse(await readFile(file, 'utf8')); value.expiresAt = 0; await writeFile(file, JSON.stringify(value)) })
    const restarted = new PodIdentityManager(fixture.cache).connection(reference, 'fixture-mac')
    expect(await restarted.accessToken()).toBe('SYNTHETIC_POD_TOKEN_2')
    expect(await readdir(join(root, 'temporary'))).toEqual([])
    expect(await readFile(join(root, `${fixture.connectionId}.encrypted`), 'utf8')).not.toContain('PRIVATE KEY')
    expect(JSON.stringify(reference)).not.toContain('Token')
  })
  it('fails closed on cross-pod cache references and denied refresh without using owner credentials', async () => {
    const fixture = await setup()
    const reference = await fixture.identity.provision(fixture.connectionId, 'Fixture', 'SYNTHETIC_OWNER')
    await expect(fixture.identity.connection({ ...reference, podId: randomUUID() }, 'fixture-mac').accessToken()).rejects.toThrow('binding mismatch')
    fixture.state.denied = true
    await expect(fixture.identity.connection(reference, 'fixture-mac').accessToken()).rejects.toThrow('(403)')
    expect(fixture.state.authenticated).toBe(0)
    expect(await readdir(join(root, 'temporary'))).toEqual([])
  })
})
