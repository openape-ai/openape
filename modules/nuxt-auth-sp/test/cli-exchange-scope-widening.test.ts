import type { H3Event } from 'h3'
import type { JWK, KeyLike } from 'jose'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// /api/cli/exchange scope enforcement (#1035, protocol#6), catalog check
// (sp-data-access §3.2) and delegation-grant revocation (§5.4). Ported from
// apps/openape-troop/tests/cli-exchange-scope-widening.test.ts when the
// exchange was consolidated into this module (#1043).
//
// A DELEGATED subject_token (RFC 8693 act OBJECT) must always state its own
// bounds via a `scope` claim — sp-data-access §5.2. A federated or older IdP
// can still mint delegated tokens WITHOUT scope; those must be rejected, not
// treated as "free choice from the catalog". And `scope: []` means "nothing",
// never "everything".
//
// First-party tokens (string act, no scope claim) stay unrestricted per
// sp-data-access §5.3 — cli-exchange-first-party.test.ts pins that down.
//
// The catalog comes from the SP's runtime config (`openapeSp.manifest.scopes`,
// troop's catalog serving as the template here). Real EdDSA signatures; only
// the JWKS transport and the DDISA/SSRF seams are stubbed.

const SECRET = 'exchange-test-secret-at-least-32-chars!!'
const CLIENT_ID = 'troop.openape.ai'
const IDP_URL = 'https://id.openape.ai'

const { mockResolveIssuer, mockAssertSafe, mockReadBody, mockSetResponseStatus, jwksHolder, configHolder } = vi.hoisted(() => ({
  mockResolveIssuer: vi.fn(),
  mockAssertSafe: vi.fn(),
  mockReadBody: vi.fn(),
  mockSetResponseStatus: vi.fn(),
  jwksHolder: { keys: [] as JWK[] },
  configHolder: { manifest: undefined as undefined | { scopes?: Array<{ id: string, description: string }> } },
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: vi.fn(() => ({
    openapeSp: { sessionSecret: SECRET, clientId: CLIENT_ID, manifest: configHolder.manifest },
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

const DELEGATE = 'igor4-cb6bf26a+patrick+hofmann_eco@id.openape.ai'

// troop's published catalog as the template (sp-data-access §3)
const TROOP_LIKE_CATALOG = {
  scopes: [
    { id: 'troop:read-agents', description: 'Read the agent list.' },
    { id: 'troop:spawn-agent', description: 'Spawn new agents.' },
  ],
}

async function signSubjectToken(claims: { act?: unknown, scope?: unknown, delegation_grant?: string } = {}): Promise<string> {
  const payload: Record<string, unknown> = {}
  if (claims.act !== undefined) payload.act = claims.act
  if (claims.scope !== undefined) payload.scope = claims.scope
  if (claims.delegation_grant !== undefined) payload.delegation_grant = claims.delegation_grant
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'EdDSA', kid: 'idp-test-key' })
    .setIssuer(IDP_URL)
    .setAudience('apes-cli')
    .setSubject('alice@openape.ai')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(idpPriv)
}

function decodeMinted(result: Record<string, unknown>): Record<string, unknown> {
  const [, payloadB64] = (result.access_token as string).split('.')
  return JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf-8'))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveIssuer.mockResolvedValue({ sub: 'alice@openape.ai', issuer: IDP_URL, jwksUri: `${IDP_URL}/.well-known/jwks.json` })
  mockAssertSafe.mockResolvedValue(undefined)
  configHolder.manifest = TROOP_LIKE_CATALOG
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /api/cli/exchange — delegated scope enforcement (#1035)', () => {
  it('rejects a delegated token WITHOUT a scope claim (fail closed, 401)', async () => {
    mockReadBody.mockResolvedValue({
      subject_token: await signSubjectToken({ act: { sub: DELEGATE } }),
      scopes: ['troop:read-agents'],
    })
    await expect(handler(fakeEvent)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects a delegated token WITHOUT a scope claim even when no scopes are requested', async () => {
    mockReadBody.mockResolvedValue({ subject_token: await signSubjectToken({ act: { sub: DELEGATE } }) })
    await expect(handler(fakeEvent)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('allows requesting exactly the granted scopes', async () => {
    mockReadBody.mockResolvedValue({
      subject_token: await signSubjectToken({ act: { sub: DELEGATE }, scope: ['troop:read-agents'] }),
      scopes: ['troop:read-agents'],
    })
    const result = await handler(fakeEvent)
    expect(result.scope).toEqual(['troop:read-agents'])
    expect(decodeMinted(result).scope).toEqual(['troop:read-agents'])
  })

  it('rejects widening beyond the granted scopes', async () => {
    mockReadBody.mockResolvedValue({
      subject_token: await signSubjectToken({ act: { sub: DELEGATE }, scope: ['troop:read-agents'] }),
      scopes: ['troop:read-agents', 'troop:spawn-agent'],
    })
    await expect(handler(fakeEvent)).rejects.toMatchObject({ statusCode: 400, statusMessage: 'invalid_scope' })
  })

  it('treats scope: [] as "nothing" — requesting any scope is widening', async () => {
    mockReadBody.mockResolvedValue({
      subject_token: await signSubjectToken({ act: { sub: DELEGATE }, scope: [] }),
      scopes: ['troop:read-agents'],
    })
    await expect(handler(fakeEvent)).rejects.toMatchObject({ statusCode: 400, statusMessage: 'invalid_scope' })
  })

  it('exchanges a scope: [] token when nothing is requested — minted token carries []', async () => {
    mockReadBody.mockResolvedValue({
      subject_token: await signSubjectToken({ act: { sub: DELEGATE }, scope: [] }),
    })
    const result = await handler(fakeEvent)
    expect(result.scope).toEqual([])
    expect(decodeMinted(result).scope).toEqual([])
  })
})

describe('POST /api/cli/exchange — catalog check (sp-data-access §3.2)', () => {
  it('act=human without scope claim may request any catalog scope', async () => {
    mockReadBody.mockResolvedValue({
      subject_token: await signSubjectToken({ act: 'human' }),
      scopes: ['troop:spawn-agent', 'troop:read-agents'],
    })
    const result = await handler(fakeEvent)
    expect(result.scope).toEqual(['troop:spawn-agent', 'troop:read-agents'])
    expect(decodeMinted(result).scope).toEqual(['troop:spawn-agent', 'troop:read-agents'])
  })

  it('rejects scopes outside the catalog with 400 invalid_scope', async () => {
    mockReadBody.mockResolvedValue({
      subject_token: await signSubjectToken({ act: 'human' }),
      scopes: ['troop:not-a-scope'],
    })
    await expect(handler(fakeEvent)).rejects.toMatchObject({ statusCode: 400, statusMessage: 'invalid_scope' })
  })

  it('skips the catalog check when the SP publishes no catalog', async () => {
    configHolder.manifest = undefined
    mockReadBody.mockResolvedValue({
      subject_token: await signSubjectToken({ act: 'human' }),
      scopes: ['anything:goes'],
    })
    const result = await handler(fakeEvent)
    expect(result.scope).toEqual(['anything:goes'])
  })
})

describe('POST /api/cli/exchange — delegation grant revocation (sp-data-access §5.4)', () => {
  function stubGrantEndpoint(reply: { status: number, body?: unknown } | 'network-error') {
    const mockFetch = vi.fn(async () => {
      if (reply === 'network-error') throw new TypeError('fetch failed')
      return {
        status: reply.status,
        ok: reply.status >= 200 && reply.status < 300,
        json: async () => reply.body,
      }
    })
    vi.stubGlobal('fetch', mockFetch)
    return mockFetch
  }

  async function delegatedTokenWithGrant(): Promise<string> {
    return signSubjectToken({ act: { sub: DELEGATE }, scope: ['troop:read-agents'], delegation_grant: 'grant-123' })
  }

  it('exchanges when the grant is live-approved — and hits the IdP status endpoint', async () => {
    const mockFetch = stubGrantEndpoint({ status: 200, body: { status: 'approved' } })
    mockReadBody.mockResolvedValue({ subject_token: await delegatedTokenWithGrant() })
    const result = await handler(fakeEvent)
    expect(result.scope).toEqual(['troop:read-agents'])
    expect(mockFetch).toHaveBeenCalledWith(`${IDP_URL}/api/grants/grant-123`)
  })

  it('rejects a revoked grant with 401 even though the token is still valid', async () => {
    stubGrantEndpoint({ status: 200, body: { status: 'revoked' } })
    mockReadBody.mockResolvedValue({ subject_token: await delegatedTokenWithGrant() })
    await expect(handler(fakeEvent)).rejects.toMatchObject({ statusCode: 401, statusMessage: 'delegation grant not active' })
  })

  it('rejects an unknown grant (404) with 401', async () => {
    stubGrantEndpoint({ status: 404 })
    mockReadBody.mockResolvedValue({ subject_token: await delegatedTokenWithGrant() })
    await expect(handler(fakeEvent)).rejects.toMatchObject({ statusCode: 401, statusMessage: 'delegation grant not active' })
  })

  it('fails closed with 502 when the IdP is unreachable', async () => {
    stubGrantEndpoint('network-error')
    mockReadBody.mockResolvedValue({ subject_token: await delegatedTokenWithGrant() })
    await expect(handler(fakeEvent)).rejects.toMatchObject({ statusCode: 502, statusMessage: 'could not verify delegation grant status' })
  })
})

// The guard that would have caught #1043 automatically: had a response-shape
// test like this existed against the MODULE handler, the prod probe showing
// `{access_token, aud, expires_at, token_type}` for a delegated exchange would
// have failed in CI instead of being discovered live.
describe('POST /api/cli/exchange — response carries the full delegated form (#1043 shadowing guard)', () => {
  it('a delegated exchange answers with scope AND delegate', async () => {
    mockReadBody.mockResolvedValue({
      subject_token: await signSubjectToken({ act: { sub: DELEGATE }, scope: ['troop:read-agents'] }),
    })
    const result = await handler(fakeEvent)
    expect(mockSetResponseStatus).toHaveBeenCalledWith(fakeEvent, 201)
    expect(Object.keys(result).sort()).toEqual(['access_token', 'aud', 'delegate', 'expires_at', 'scope', 'token_type'])
    expect(result.scope).toEqual(['troop:read-agents'])
    expect(result.delegate).toBe(DELEGATE)
    const minted = decodeMinted(result)
    expect(minted.scope).toEqual(['troop:read-agents'])
    expect(minted.delegate).toBe(DELEGATE)
  })
})
