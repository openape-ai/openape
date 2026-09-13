// @vitest-environment node
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { expect, it } from 'vitest'
import { ownerClaims } from '../../src/main/connections/owner'
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
