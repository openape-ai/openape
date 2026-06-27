import type { H3Event } from 'h3'
import type { JWK, KeyLike } from 'jose'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// This suite verifies the RFC 8693 exchange against REAL signatures: a real
// keypair signs the subject_token and jose's real jwtVerify checks it against
// the matching public key. Only the JWKS *transport* is stubbed — the handler's
// createRemoteJWKSet (a network fetch) is swapped for jose's createLocalJWKSet
// over the real public key, so no network is touched but the signature /
// issuer / audience verification runs for real. The other seams have their own
// tests: resolveIssuerForToken (ddisa-issuer.test.ts), assertSafeIdpUrl
// (ssrf-guard.test.ts). A forged or wrong-key token is rejected by the actual
// crypto, not by a mock.

const { mockResolveIssuer, mockAssertSafe, mockReadBody, mockSetResponseStatus, jwksHolder } = vi.hoisted(() => ({
  mockResolveIssuer: vi.fn(),
  mockAssertSafe: vi.fn(),
  mockReadBody: vi.fn(),
  mockSetResponseStatus: vi.fn(),
  jwksHolder: { keys: [] as JWK[] },
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: vi.fn(() => ({
    openapeSp: { sessionSecret: 'exchange-test-secret-at-least-32-chars!!' },
  })),
}))

vi.mock('../src/runtime/server/utils/sp-config', () => ({
  getSpConfig: () => ({ clientId: 'chat.openape.ai' }),
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

const { createCliExchangeHandler } = await import('../src/runtime/server/utils/cli-exchange')
const fakeEvent = {} as H3Event
const CLIENT_ID = 'chat.openape.ai'
const IDP_URL = 'https://id.openape.ai'

// Real IdP signing keypair, generated once. Its public JWK populates the local
// keyset the handler verifies against; `wrongPriv` signs tokens that must fail.
const idpPair = await generateKeyPair('EdDSA', { extractable: true })
const idpPriv: KeyLike = idpPair.privateKey
const idpPubJwk: JWK = { ...(await exportJWK(idpPair.publicKey)), kid: 'idp-test-key', alg: 'EdDSA', use: 'sig' }
const wrongPriv: KeyLike = (await generateKeyPair('EdDSA', { extractable: true })).privateKey
jwksHolder.keys.push(idpPubJwk)

async function signSubjectToken(
  key: KeyLike,
  claims: { iss?: string, aud?: string, sub?: string, act?: string } = {},
): Promise<string> {
  return new SignJWT(claims.act ? { act: claims.act } : {})
    .setProtectedHeader({ alg: 'EdDSA', kid: 'idp-test-key' })
    .setIssuer(claims.iss ?? IDP_URL)
    .setAudience(claims.aud ?? 'apes-cli')
    .setSubject(claims.sub ?? 'alice@openape.ai')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveIssuer.mockResolvedValue({ sub: 'alice@openape.ai', issuer: IDP_URL, jwksUri: `${IDP_URL}/.well-known/jwks.json` })
  mockAssertSafe.mockResolvedValue(undefined)
})

describe('createCliExchangeHandler — real signature verification', () => {
  it('mints an SP token (201) for a validly-signed subject_token', async () => {
    mockReadBody.mockResolvedValue({ subject_token: await signSubjectToken(idpPriv) })
    const result = await createCliExchangeHandler()(fakeEvent) as Record<string, unknown>
    expect(mockSetResponseStatus).toHaveBeenCalledWith(fakeEvent, 201)
    expect(result.token_type).toBe('Bearer')
    expect(result.aud).toBe(CLIENT_ID)
    expect(typeof result.access_token).toBe('string')
  })

  it('rejects a token signed by the WRONG key with 401', async () => {
    mockReadBody.mockResolvedValue({ subject_token: await signSubjectToken(wrongPriv) })
    await expect(createCliExchangeHandler()(fakeEvent)).rejects.toMatchObject({ statusCode: 401, statusMessage: 'Invalid subject_token' })
  })

  it('rejects a token with the wrong audience with 401', async () => {
    mockReadBody.mockResolvedValue({ subject_token: await signSubjectToken(idpPriv, { aud: 'some-other-sp' }) })
    await expect(createCliExchangeHandler()(fakeEvent)).rejects.toMatchObject({ statusCode: 401, statusMessage: 'Invalid subject_token' })
  })

  it('rejects a token whose issuer differs from the resolved IdP with 401', async () => {
    mockReadBody.mockResolvedValue({ subject_token: await signSubjectToken(idpPriv, { iss: 'https://evil.example.com' }) })
    await expect(createCliExchangeHandler()(fakeEvent)).rejects.toMatchObject({ statusCode: 401, statusMessage: 'Invalid subject_token' })
  })

  it('rejects a verified token whose sub is not an email with 401', async () => {
    mockResolveIssuer.mockResolvedValue({ sub: 'not-an-email', issuer: IDP_URL, jwksUri: `${IDP_URL}/.well-known/jwks.json` })
    mockReadBody.mockResolvedValue({ subject_token: await signSubjectToken(idpPriv, { sub: 'not-an-email' }) })
    await expect(createCliExchangeHandler()(fakeEvent)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('maps act=agent from the verified claims onto the minted SP token', async () => {
    mockResolveIssuer.mockResolvedValue({ sub: 'bot@openape.ai', issuer: IDP_URL, jwksUri: `${IDP_URL}/.well-known/jwks.json` })
    mockReadBody.mockResolvedValue({ subject_token: await signSubjectToken(idpPriv, { sub: 'bot@openape.ai', act: 'agent' }) })
    const result = await createCliExchangeHandler()(fakeEvent) as Record<string, unknown>
    const [, payloadB64] = (result.access_token as string).split('.')
    const payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf-8'))
    expect(payload.act).toBe('agent')
  })

  it('echoes requested scopes back on success', async () => {
    mockReadBody.mockResolvedValue({ subject_token: await signSubjectToken(idpPriv), scopes: ['chat:read', 'chat:write'] })
    const result = await createCliExchangeHandler()(fakeEvent) as Record<string, unknown>
    expect(result.scopes).toEqual(['chat:read', 'chat:write'])
  })
})

describe('createCliExchangeHandler — request/plumbing errors', () => {
  it('returns 400 when subject_token is missing', async () => {
    mockReadBody.mockResolvedValue({})
    await expect(createCliExchangeHandler()(fakeEvent)).rejects.toMatchObject({ statusCode: 400, statusMessage: 'subject_token required' })
  })

  it('returns 401 when DDISA resolution yields no usable subject', async () => {
    mockReadBody.mockResolvedValue({ subject_token: 'bad.token.here' })
    mockResolveIssuer.mockResolvedValue(null)
    await expect(createCliExchangeHandler()(fakeEvent)).rejects.toMatchObject({ statusCode: 401, statusMessage: 'subject_token has no usable subject claim' })
  })

  it('returns 502 when the resolved issuer is rejected by the SSRF guard', async () => {
    mockReadBody.mockResolvedValue({ subject_token: await signSubjectToken(idpPriv) })
    mockAssertSafe.mockRejectedValue(new Error('IdP issuer host resolves to a blocked address (169.254.169.254)'))
    await expect(createCliExchangeHandler()(fakeEvent)).rejects.toMatchObject({ statusCode: 502, statusMessage: 'IdP issuer not permitted' })
  })
})
