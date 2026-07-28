import type { H3Event } from 'h3'
import type { JWK, KeyLike } from 'jose'
import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// First-party regression baseline for POST /api/cli/exchange (#1043).
//
// This is the path EVERY CLI login takes (`apes login` → exchangeForSpToken
// against every SP): subject_token with aud='apes-cli', a string (or absent)
// `act`, NO scope claim, and no `scopes` in the request body. Its response
// shape and the minted token (claims, TTL) are pinned down EXACTLY, so the
// exchange consolidation cannot silently change what all existing CLIs
// receive. Same harness as cli-exchange.test.ts: real EdDSA signatures, only
// the JWKS transport and the DDISA/SSRF seams are stubbed.

const SECRET = 'exchange-test-secret-at-least-32-chars!!'
const CLIENT_ID = 'troop.openape.ai'
const IDP_URL = 'https://id.openape.ai'

const { mockResolveIssuer, mockAssertSafe, mockReadBody, mockSetResponseStatus, jwksHolder } = vi.hoisted(() => ({
  mockResolveIssuer: vi.fn(),
  mockAssertSafe: vi.fn(),
  mockReadBody: vi.fn(),
  mockSetResponseStatus: vi.fn(),
  jwksHolder: { keys: [] as JWK[] },
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: vi.fn(() => ({
    openapeSp: { sessionSecret: SECRET, clientId: CLIENT_ID },
  })),
}))

vi.mock('../src/runtime/server/utils/sp-config', () => ({
  getSpConfig: () => ({ clientId: CLIENT_ID }),
}))

vi.mock('../src/runtime/server/utils/ddisa-issuer', () => ({
  resolveIssuerForToken: (token: string) => mockResolveIssuer(token),
}))

vi.mock('../src/runtime/server/utils/ssrf-guard', () => ({
  assertSafeIdpUrl: (url: string) => mockAssertSafe(url),
}))

// Swap ONLY the remote JWKS fetch for a local keyset over the real public key.
// jwtVerify stays real, so signature/issuer/audience checks are genuine.
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>()
  return {
    ...actual,
    createRemoteJWKSet: () => actual.createLocalJWKSet(jwksHolder),
  }
})

vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>()
  return {
    ...actual,
    readBody: mockReadBody,
    setResponseStatus: mockSetResponseStatus,
    defineEventHandler: (fn: (event: H3Event) => unknown) => fn,
    createError: (opts: { statusCode: number, statusMessage: string, data?: unknown }) =>
      Object.assign(new Error(opts.statusMessage), opts),
  }
})

// Import the ROUTE handler file — the artefact addServerHandler registers and
// prod serves — not an internal helper. This is deliberate (#1043): the suite
// must pin the behaviour of what actually answers /api/cli/exchange.
const handler = (await import('../src/runtime/server/api/cli/exchange.post')).default as unknown as (event: H3Event) => Promise<Record<string, unknown>>
const fakeEvent = {} as H3Event

const idpPair = await generateKeyPair('EdDSA', { extractable: true })
const idpPriv: KeyLike = idpPair.privateKey
jwksHolder.keys.push({ ...(await exportJWK(idpPair.publicKey)), kid: 'idp-test-key', alg: 'EdDSA', use: 'sig' })

async function signSubjectToken(claims: { sub?: string, act?: unknown } = {}): Promise<string> {
  const payload: Record<string, unknown> = {}
  if (claims.act !== undefined) payload.act = claims.act
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'EdDSA', kid: 'idp-test-key' })
    .setIssuer(IDP_URL)
    .setAudience('apes-cli')
    .setSubject(claims.sub ?? 'alice@openape.ai')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(idpPriv)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveIssuer.mockResolvedValue({ sub: 'alice@openape.ai', issuer: IDP_URL, jwksUri: `${IDP_URL}/.well-known/jwks.json` })
  mockAssertSafe.mockResolvedValue(undefined)
})

describe('POST /api/cli/exchange — first-party path is byte-identical (#1043 baseline)', () => {
  it('responds 201 with EXACTLY {access_token, token_type, expires_at, aud}', async () => {
    mockReadBody.mockResolvedValue({ subject_token: await signSubjectToken({ act: 'human' }) })
    const result = await handler(fakeEvent)
    expect(mockSetResponseStatus).toHaveBeenCalledWith(fakeEvent, 201)
    expect(Object.keys(result).sort()).toEqual(['access_token', 'aud', 'expires_at', 'token_type'])
    expect(result.token_type).toBe('Bearer')
    expect(result.aud).toBe(CLIENT_ID)
  })

  it('mints a token with EXACTLY {typ, sub, email, act, iat, exp, iss, aud} — no scope, no delegate', async () => {
    mockReadBody.mockResolvedValue({ subject_token: await signSubjectToken({ act: 'human' }) })
    const result = await handler(fakeEvent)
    const { payload } = await jwtVerify(result.access_token as string, new TextEncoder().encode(SECRET), {
      issuer: CLIENT_ID,
      audience: CLIENT_ID,
    })
    expect(Object.keys(payload).sort()).toEqual(['act', 'aud', 'email', 'exp', 'iat', 'iss', 'sub', 'typ'])
    expect(payload.typ).toBe('cli')
    expect(payload.sub).toBe('alice@openape.ai')
    expect(payload.email).toBe('alice@openape.ai')
    expect(payload.act).toBe('human')
  })

  it('keeps the 30-day first-party TTL', async () => {
    mockReadBody.mockResolvedValue({ subject_token: await signSubjectToken({ act: 'human' }) })
    const result = await handler(fakeEvent)
    const { payload } = await jwtVerify(result.access_token as string, new TextEncoder().encode(SECRET))
    expect(payload.exp! - payload.iat!).toBe(30 * 24 * 3600)
    expect(result.expires_at).toBe(payload.exp)
  })

  it('maps act=agent through unchanged', async () => {
    mockResolveIssuer.mockResolvedValue({ sub: 'bot@openape.ai', issuer: IDP_URL, jwksUri: `${IDP_URL}/.well-known/jwks.json` })
    mockReadBody.mockResolvedValue({ subject_token: await signSubjectToken({ sub: 'bot@openape.ai', act: 'agent' }) })
    const result = await handler(fakeEvent)
    expect(Object.keys(result).sort()).toEqual(['access_token', 'aud', 'expires_at', 'token_type'])
    const { payload } = await jwtVerify(result.access_token as string, new TextEncoder().encode(SECRET))
    expect(payload.act).toBe('agent')
    expect(payload.sub).toBe('bot@openape.ai')
  })

  it('fails closed to act=agent when the claim is absent (#1034/#1040)', async () => {
    mockReadBody.mockResolvedValue({ subject_token: await signSubjectToken() })
    const result = await handler(fakeEvent)
    expect(Object.keys(result).sort()).toEqual(['access_token', 'aud', 'expires_at', 'token_type'])
    const { payload } = await jwtVerify(result.access_token as string, new TextEncoder().encode(SECRET))
    expect(payload.act).toBe('agent')
  })
})
