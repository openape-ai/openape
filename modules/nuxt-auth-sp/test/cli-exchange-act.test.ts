import type { H3Event } from 'h3'
import type { JWK, KeyLike } from 'jose'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// /api/cli/exchange mints the SP's HS256 CLI token from a verified IdP
// subject_token. The `act` claim on that subject_token is polymorphic —
// string OR RFC 8693 delegation object ({sub: <delegate>}). The old string
// comparison upgraded the object form to 'human', which lets a delegated
// token skip downstream scope checks (#1034). Ported from
// apps/openape-troop/tests/cli-exchange-act.test.ts when the exchange was
// consolidated into this module (#1043). Real EdDSA signatures; only the
// JWKS transport and the DDISA/SSRF seams are stubbed.

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

const handler = (await import('../src/runtime/server/api/cli/exchange.post')).default as unknown as (event: H3Event) => Promise<Record<string, unknown>>
const fakeEvent = {} as H3Event

const idpPair = await generateKeyPair('EdDSA', { extractable: true })
const idpPriv: KeyLike = idpPair.privateKey
jwksHolder.keys.push({ ...(await exportJWK(idpPair.publicKey)), kid: 'idp-test-key', alg: 'EdDSA', use: 'sig' })

async function signSubjectToken(claims: { sub?: string, act?: unknown, scope?: unknown } = {}): Promise<string> {
  const payload: Record<string, unknown> = {}
  if (claims.act !== undefined) payload.act = claims.act
  if (claims.scope !== undefined) payload.scope = claims.scope
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'EdDSA', kid: 'idp-test-key' })
    .setIssuer(IDP_URL)
    .setAudience('apes-cli')
    .setSubject(claims.sub ?? 'alice@openape.ai')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(idpPriv)
}

function decodeMinted(result: Record<string, unknown>): { act: unknown, delegate: unknown } {
  const [, payloadB64] = (result.access_token as string).split('.')
  const payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf-8'))
  return { act: payload.act, delegate: payload.delegate }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveIssuer.mockResolvedValue({ sub: 'alice@openape.ai', issuer: IDP_URL, jwksUri: `${IDP_URL}/.well-known/jwks.json` })
  mockAssertSafe.mockResolvedValue(undefined)
})

describe('POST /api/cli/exchange — act normalization (#1034)', () => {
  it('mints act=agent for an RFC 8693 delegation act OBJECT — never human', async () => {
    // scope: [] because #1035 rejects delegated tokens WITHOUT a scope
    // claim — this test only cares about act normalization.
    mockReadBody.mockResolvedValue({ subject_token: await signSubjectToken({ act: { sub: 'igor4-cb6bf26a+patrick+hofmann_eco@id.openape.ai' }, scope: [] }) })
    const minted = decodeMinted(await handler(fakeEvent))
    expect(minted.act).toBe('agent')
    // provenance: the delegate sub from the act object rides along
    expect(minted.delegate).toBe('igor4-cb6bf26a+patrick+hofmann_eco@id.openape.ai')
  })

  it('keeps a plain human token human', async () => {
    mockReadBody.mockResolvedValue({ subject_token: await signSubjectToken({ act: 'human' }) })
    const minted = decodeMinted(await handler(fakeEvent))
    expect(minted.act).toBe('human')
    // first-party token stays claim-identical: no delegate claim at all
    expect(minted.delegate).toBeUndefined()
  })

  it('fails closed to agent when act is absent', async () => {
    mockReadBody.mockResolvedValue({ subject_token: await signSubjectToken() })
    expect(decodeMinted(await handler(fakeEvent)).act).toBe('agent')
  })
})
