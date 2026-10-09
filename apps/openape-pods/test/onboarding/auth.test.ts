// @vitest-environment node
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { request } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { OwnerConnection, ownerClaims } from '../../src/main/connections/owner'
import type { CredentialCache } from '../../src/main/connections/cache'
import { parseOnboardingCommand, parseSince } from '../../src/contracts/onboarding'
import { readJSON } from '../../src/main/connections/http'

it('verifies owner signature, audience, human role, expiry, nonce and expected identity', () => {
  const keys = generateKeyPairSync('ed25519'); const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'owner-key' }
  const claims = { iss: 'https://identity.example.invalid', aud: 'apes-cli', act: 'human', sub: 'owner', email: 'owner@example.invalid', nonce: 'state-nonce', exp: Math.floor(Date.now() / 1000) + 300 }
  const token = (body: Record<string, unknown>) => { const data = [Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: jwk.kid })).toString('base64url'), Buffer.from(JSON.stringify(body)).toString('base64url')].join('.'); return `${data}.${sign(null, Buffer.from(data), keys.privateKey).toString('base64url')}` }
  expect(ownerClaims(token(claims), { keys: [jwk] }, claims.iss, claims.email, claims.nonce).sub).toBe('owner')
  for (const delta of [{ aud: 'another-client' }, { act: 'agent' }, { email: 'foreign@example.invalid' }, { exp: 1 }, { nonce: 'foreign' }, { nbf: Date.now() / 1000 + 100 }, { iss: 'https://foreign.invalid' }]) expect(() => ownerClaims(token({ ...claims, ...delta }), { keys: [jwk] }, claims.iss, claims.email, claims.nonce)).toThrow()
  expect(() => ownerClaims(`${token(claims).slice(0, -8)}AAAAAAAA`, { keys: [jwk] }, claims.iss, claims.email)).toThrow('signature')
  expect(() => ownerClaims(token(claims), { keys: [jwk, jwk] }, claims.iss, claims.email)).toThrow('signature')
})
afterEach(() => { vi.unstubAllGlobals() })
// The MCP session re-runs the owner's browser sign-in: the real loopback callback,
// code exchange and token checks, with only the identity provider replaced.
it('proves the MCP owner sign-in only for a human token of the registered account and stores nothing', async () => {
  const keys = generateKeyPairSync('ed25519'); const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'owner-key' }
  const issuer = 'https://identity.example.invalid'; const account = 'owner@example.invalid'
  const token = (body: Record<string, unknown>) => { const data = [Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: jwk.kid })).toString('base64url'), Buffer.from(JSON.stringify(body)).toString('base64url')].join('.'); return `${data}.${sign(null, Buffer.from(data), keys.privateKey).toString('base64url')}` }
  let claims: (nonce: string) => Record<string, unknown> = () => ({}); let nonce = ''
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === `${issuer}/token`) return new Response(JSON.stringify({ access_token: token(claims(nonce)), refresh_token: 'synthetic-refresh' }))
    if (url === `${issuer}/.well-known/jwks.json`) return new Response(JSON.stringify({ keys: [jwk] }))
    throw new Error(`Unexpected request ${url}`)
  }))
  const connect = vi.fn(); const owner = new OwnerConnection({ connect } as unknown as CredentialCache)
  const callback = (url: string) => new Promise<void>((resolve, reject) => {
    const target = new URL(url).searchParams; nonce = target.get('nonce')!
    const query = new URLSearchParams({ state: target.get('state')!, code: 'synthetic-code' })
    request({ host: '127.0.0.1', port: 9876, path: `/callback?${query}`, headers: { host: 'localhost:9876' } }, (response) => { response.resume(); response.on('end', resolve) }).on('error', reject).end()
  })
  // Like a browser, the callback is answered while the sign-in continues; its delivery is awaited, never dropped.
  const verify = async () => {
    let delivered = Promise.resolve()
    const result = owner.verify(issuer, account, new AbortController().signal, ({ url }) => { delivered = callback(url) })
    try { return await result }
    finally { await delivered }
  }
  const human = (value: string) => ({ iss: issuer, aud: 'apes-cli', act: 'human', sub: 'owner-subject', email: account, nonce: value, exp: Math.floor(Date.now() / 1000) + 300 })
  claims = human
  expect(await verify()).toEqual({ subject: 'owner-subject' })
  for (const change of [{ act: 'agent' }, { email: 'foreign@example.invalid' }, { aud: 'another-client' }, { nonce: 'replayed-nonce' }]) {
    claims = value => ({ ...human(value), ...change })
    await expect(verify(), JSON.stringify(change)).rejects.toThrow('Owner identity does not match the requested account')
  }
  expect(connect).not.toHaveBeenCalled()
})
it('rejects privilege-bearing setup input and invalid historical boundaries', () => {
  for (const value of [{ type: 'connect', provider: 'microsoft', account: 'a@example.invalid', issuer: 'https://foreign.invalid' }, { type: 'connect', provider: 'openape', account: 'a@example.invalid', issuer: 'http://localhost' }, { type: 'connect', provider: 'chatgpt', account: '', token: 'forbidden' }, { type: 'save', connection: {} }]) expect(() => parseOnboardingCommand(value)).toThrow()
  expect(parseSince(null)).toBeNull(); expect(parseSince('2026-06-01T00:00:00Z')).toBe('2026-06-01T00:00:00Z')
  for (const value of ['2026-02-30T00:00:00Z', '2026-06-01T12:00:00Z', '2026-06-01', createHash('sha256').update('not-date').digest('hex')]) expect(() => parseSince(value)).toThrow()
  expect(() => parseOnboardingCommand({ type: 'assign', setup: { podId: randomUUID(), revision: 1, ownerConnection: randomUUID(), mailConnection: randomUUID(), account: 'a@example.invalid', folders: [{ id: '../foreign', name: 'Foreign' }], since: null, attachments: false } })).toThrow()
})
it('stops oversized authentication responses before parsing and hides provider error bodies', async () => {
  await expect(readJSON(new Response('secret detail', { status: 401 }))).rejects.toThrow('401')
  await expect(readJSON(new Response(JSON.stringify({ content: 'a'.repeat(130 * 1024) })))).rejects.toThrow('limit')
  await expect(readJSON(new Response('[]'))).rejects.toThrow('Invalid')
})

it('accepts explicit account actions without accepting identity or token injection', () => {
  const id = randomUUID()
  for (const type of ['disconnect', 'cancel']) {
    expect(parseOnboardingCommand({ type, id })).toEqual({ type, id })
    expect(() => parseOnboardingCommand({ type, id: 'not-an-id' })).toThrow()
    expect(() => parseOnboardingCommand({ type, id, token: 'forbidden' })).toThrow()
  }
  for (const type of ['setDefaultOwner', 'reconnect']) expect(() => parseOnboardingCommand({ type, id })).toThrow('Unsupported')
  expect(() => parseOnboardingCommand({ type: 'connect', provider: 'openape', account: 'owner@example.invalid', issuer: 'https://id.example.invalid' })).toThrow('Unsupported')
  expect(() => parseOnboardingCommand({ type: 'connect', provider: 'chatgpt', account: '', switchAccount: true })).toThrow('DDISA')
  expect(parseOnboardingCommand({ type: 'connect', provider: 'openape', account: 'owner@example.invalid', switchAccount: true })).toMatchObject({ switchAccount: true })
})
