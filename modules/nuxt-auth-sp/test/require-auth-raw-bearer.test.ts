import type { H3Event } from 'h3'
import type { JWK, KeyLike } from 'jose'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Raw IdP bearer tokens on requireCaller: the trusted issuer comes from the
// subject's DDISA record, never from the token's own `iss`. The real
// ddisa-issuer and jose jwtVerify run; only DNS (resolveIdP), the SSRF DNS
// check and the JWKS transport are stubbed.

const IDP_URL = 'https://id.openape.ai'
const ATTACKER_URL = 'https://idp.attacker.example'
const VICTIM = 'patrick@hofmann.eco'

const { mockGetHeader, mockResolveIdP, mockAssertSafe, jwksByUrl } = vi.hoisted(() => ({
  mockGetHeader: vi.fn(),
  mockResolveIdP: vi.fn(),
  mockAssertSafe: vi.fn(),
  jwksByUrl: new Map<string, { keys: JWK[] }>(),
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ openapeSp: { sessionSecret: 'test-session-secret-at-least-32-chars!!' } }),
}))
vi.mock('../src/runtime/server/utils/sp-config', () => ({ getSpConfig: () => ({ clientId: 'tasks.openape.ai' }) }))
vi.mock('../src/runtime/server/utils/ssrf-guard', () => ({ assertSafeIdpUrl: (url: string) => mockAssertSafe(url) }))
vi.mock('@openape/core', async importOriginal => ({
  ...(await importOriginal<typeof import('@openape/core')>()),
  resolveIdP: (domain: string) => mockResolveIdP(domain),
}))
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>()
  return {
    ...actual,
    createRemoteJWKSet: (url: URL) => actual.createLocalJWKSet(jwksByUrl.get(url.origin) ?? { keys: [] }),
  }
})
vi.mock('h3', async importOriginal => ({
  ...(await importOriginal<typeof import('h3')>()),
  getHeader: (e: H3Event, n: string) => mockGetHeader(e, n),
  useSession: async () => ({ data: {} }),
}))

const { requireCaller } = await import('../src/runtime/server/utils/require-auth')

async function keyPair(kid: string): Promise<{ priv: KeyLike, jwk: JWK }> {
  const pair = await generateKeyPair('EdDSA', { extractable: true })
  return { priv: pair.privateKey, jwk: { ...(await exportJWK(pair.publicKey)), kid, alg: 'EdDSA', use: 'sig' } }
}
const idp = await keyPair('idp')
const attacker = await keyPair('attacker')
jwksByUrl.set(IDP_URL, { keys: [idp.jwk] })
jwksByUrl.set(ATTACKER_URL, { keys: [attacker.jwk] })

function sign(key: KeyLike, opts: { iss?: string, aud?: string, exp?: string | number, extra?: Record<string, unknown> } = {}) {
  return new SignJWT({ act: 'agent', ...opts.extra })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuer(opts.iss ?? IDP_URL)
    .setAudience(opts.aud ?? 'apes-cli')
    .setSubject(VICTIM)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(key)
}

// Any outbound verify call answers "valid": a forged token must fail anyway.
const fetchSpy = vi.fn(async () => ({ valid: true, claims: { email: VICTIM } }))
;(globalThis as Record<string, unknown>).$fetch = fetchSpy
const event = { path: '/' } as H3Event

async function callWith(token: string) {
  mockGetHeader.mockReturnValue(`Bearer ${token}`)
  return requireCaller(event)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveIdP.mockResolvedValue(IDP_URL)
  mockAssertSafe.mockResolvedValue(undefined)
})

describe('requireCaller — raw IdP bearer tokens', () => {
  it('authenticates a first-party token from the DDISA issuer of the subject domain', async () => {
    await expect(callWith(await sign(idp.priv))).resolves.toEqual({ email: VICTIM, act: 'agent' })
    expect(mockResolveIdP).toHaveBeenCalledWith('hofmann.eco')
  })

  it('rejects a token whose iss is not the DDISA issuer, even when that issuer says valid', async () => {
    const forged = await sign(attacker.priv, { iss: ATTACKER_URL })
    await expect(callWith(forged)).rejects.toMatchObject({ statusCode: 401 })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mockAssertSafe).not.toHaveBeenCalledWith(ATTACKER_URL)
  })

  it('rejects a token claiming the DDISA issuer but signed by an unrelated key', async () => {
    await expect(callWith(await sign(attacker.priv))).rejects.toMatchObject({ statusCode: 401 })
  })

  it.each([
    ['foreign audience', { aud: 'tasks.openape.ai' }],
    ['expired token', { exp: Math.floor(Date.now() / 1000) - 60 }],
    ['delegated act object', { extra: { act: { sub: 'bot@hofmann.eco' } } }],
    ['delegation grant', { extra: { delegation_grant: 'g1' } }],
    ['scope claim', { extra: { scope: ['tasks:read'] } }],
    ['grant AuthZ-JWT', { extra: { grant_id: 'g1' } }],
  ])('rejects a %s', async (_name, opts) => {
    await expect(callWith(await sign(idp.priv, opts))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects when the SSRF guard refuses the resolved issuer', async () => {
    mockAssertSafe.mockRejectedValue(new Error('private address'))
    await expect(callWith(await sign(idp.priv))).rejects.toMatchObject({ statusCode: 401 })
  })
})
