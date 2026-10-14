import { identityFromBasicAuth } from '../server/utils/git-auth'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import type { JWTPayload, KeyLike } from 'jose'

const boundary = vi.hoisted(() => ({ resolve: vi.fn(), safe: vi.fn(), keys: vi.fn() }))
vi.mock('@openape/core', async importOriginal => ({ ...await importOriginal<typeof import('@openape/core')>(), resolveIdP: boundary.resolve, assertPublicUrl: boundary.safe }))
vi.mock('jose', async importOriginal => ({ ...await importOriginal<typeof import('jose')>(), createRemoteJWKSet: boundary.keys }))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({ idpUrl: 'https://owner.example.test', openapeSp: { clientId: 'repos.openape.ai' } }) }))

let key: KeyLike
let foreignKey: KeyLike
beforeAll(async () => {
  const pair = await generateKeyPair('EdDSA')
  key = pair.privateKey
  foreignKey = (await generateKeyPair('EdDSA')).privateKey
  const jwk = await exportJWK(pair.publicKey)
  boundary.keys.mockImplementation(() => createLocalJWKSet({ keys: [jwk] }))
})
beforeEach(() => {
  boundary.resolve.mockReset().mockResolvedValue('https://pods.example.test')
  boundary.safe.mockReset().mockResolvedValue(undefined)
  vi.stubEnv('OPENAPE_SP_ALLOW_INSECURE_IDP', '0')
})

afterEach(() => vi.unstubAllEnvs())

async function header(claims: JWTPayload = {}, signingKey = key) {
  const token = await new SignJWT({ sub: 'pod@pods.example.test', act: 'agent', iss: 'https://pods.example.test', aud: 'apes-cli', exp: Math.floor(Date.now() / 1000) + 60, ...claims })
    .setProtectedHeader({ alg: 'EdDSA' })
    .sign(signingKey)
  return `Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`
}

describe('Git smart-HTTP identity verification', () => {
  it('accepts a direct Pod signed by its domain-authoritative IdP', async () => {
    expect(await identityFromBasicAuth(await header())).toEqual({ email: 'pod@pods.example.test', act: 'agent' })
    expect(boundary.resolve).toHaveBeenCalledWith('pods.example.test')
    expect(boundary.safe).toHaveBeenCalledWith('https://pods.example.test')
  })

  it('retains configured-IdP authentication when the subject has no DDISA record', async () => {
    boundary.resolve.mockResolvedValue(null)
    expect(await identityFromBasicAuth(await header({ sub: 'owner@example.test', iss: 'https://owner.example.test', act: 'human' })))
      .toEqual({ email: 'owner@example.test', act: 'human' })
  })

  it('retains existing configured-IdP delegated identity and scope caps', async () => {
    boundary.resolve.mockResolvedValue('https://owner.example.test')
    expect(await identityFromBasicAuth(await header({ sub: 'owner@example.test', iss: 'https://owner.example.test', act: { sub: 'pod@pods.example.test' }, scope: ['git:read'], aud: 'repos.openape.ai' })))
      .toEqual({ email: 'pod@pods.example.test', act: 'agent', delegator: 'owner@example.test', cap: 'read' })
  })

  it.each([
    { iss: 'https://owner.example.test' },
    { aud: 'another-service' },
    { exp: 1 },
    { email: 'owner@example.test' },
    { act: { sub: 'owner@example.test' } },
    { delegate: 'owner@example.test', scope: ['git:admin'] },
  ])('rejects a token with conflicting authority or claims: %j', async (claims) => {
    expect(await identityFromBasicAuth(await header(claims))).toBeNull()
  })

  it('rejects a foreign signature even with correct issuer and subject claims', async () => {
    expect(await identityFromBasicAuth(await header({}, foreignKey))).toBeNull()
  })

  it('fails closed on unsafe discovered issuers and DNS failures', async () => {
    boundary.safe.mockRejectedValueOnce(new Error('Private address'))
    expect(await identityFromBasicAuth(await header())).toBeNull()
    boundary.resolve.mockRejectedValueOnce(new Error('DNS unavailable'))
    expect(await identityFromBasicAuth(await header({ iss: 'https://owner.example.test' }))).toBeNull()
  })

  it('rejects missing or malformed credentials', async () => {
    for (const value of [undefined, 'Bearer token', 'Basic invalid', `Basic ${Buffer.from('user:invalid').toString('base64')}`]) {
      expect(await identityFromBasicAuth(value)).toBeNull()
    }
  })
})
