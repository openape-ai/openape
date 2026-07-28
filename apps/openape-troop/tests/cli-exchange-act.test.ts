import type { JWK, KeyLike } from 'jose'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// /api/cli/exchange mints troop's HS256 CLI token from a verified IdP
// subject_token. The `act` claim on that subject_token is polymorphic —
// string OR RFC 8693 delegation object ({sub: <delegate>}). The old
// string comparison upgraded the object form to 'human', which lets a
// delegated token skip the scope check in resolveOwnerContext (#1034).
// These tests run real EdDSA signatures; only the JWKS transport and
// the DDISA issuer resolution are stubbed.

const SECRET = 'troop-exchange-test-secret-32chars!!!'

const { jwksHolder, mockResolveIssuer } = vi.hoisted(() => ({
  jwksHolder: { keys: [] as JWK[] },
  mockResolveIssuer: vi.fn(),
}))

// Swap ONLY the remote JWKS fetch for a local keyset over the real public
// key — jwtVerify itself stays real.
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>()
  return {
    ...actual,
    createRemoteJWKSet: () => actual.createLocalJWKSet(jwksHolder),
  }
})

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ openapeSp: { sessionSecret: SECRET, clientId: 'troop.openape.ai' } }),
}))

vi.mock('../server/utils/ddisa-issuer', () => ({
  resolveIssuerForToken: (token: string) => mockResolveIssuer(token),
}))

// Nitro auto-imports — outside Nuxt they are plain globals.
vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
vi.stubGlobal('setResponseStatus', vi.fn())
vi.stubGlobal('createError', (opts: { statusCode: number, statusMessage: string, data?: unknown }) =>
  Object.assign(new Error(opts.statusMessage), opts))
// server/utils/cli-token.ts reads the session secret via the auto-imported
// useRuntimeConfig (no module import to mock).
vi.stubGlobal('useRuntimeConfig', () => ({ openapeSp: { sessionSecret: SECRET, clientId: 'troop.openape.ai' } }))

const bodyHolder: { body: Record<string, unknown> } = { body: {} }
vi.stubGlobal('readBody', async () => bodyHolder.body)

const handler = (await import('../server/api/cli/exchange.post')).default as unknown as (event: unknown) => Promise<Record<string, unknown>>

const IDP_URL = 'https://id.openape.ai'
const idpPair = await generateKeyPair('EdDSA', { extractable: true })
const idpPriv: KeyLike = idpPair.privateKey
jwksHolder.keys.push({ ...(await exportJWK(idpPair.publicKey)), kid: 'idp-test-key', alg: 'EdDSA', use: 'sig' })

async function signSubjectToken(claims: { sub?: string, act?: unknown, scope?: unknown } = {}): Promise<string> {
  const sub = claims.sub ?? 'alice@openape.ai'
  const payload: Record<string, unknown> = {}
  if (claims.act !== undefined) payload.act = claims.act
  if (claims.scope !== undefined) payload.scope = claims.scope
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'EdDSA', kid: 'idp-test-key' })
    .setIssuer(IDP_URL)
    .setAudience('apes-cli')
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(idpPriv)
}

function decodeMintedAct(result: Record<string, unknown>): { act: unknown, delegate: unknown } {
  const [, payloadB64] = (result.access_token as string).split('.')
  const payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf-8'))
  return { act: payload.act, delegate: payload.delegate }
}

beforeEach(() => {
  mockResolveIssuer.mockResolvedValue({ sub: 'alice@openape.ai', issuer: IDP_URL, jwksUri: `${IDP_URL}/.well-known/jwks.json` })
})

describe('POST /api/cli/exchange — act normalization (#1034)', () => {
  it('mints act=agent for an RFC 8693 delegation act OBJECT — never human', async () => {
    // scope: [] because #1035 rejects delegated tokens WITHOUT a scope
    // claim — this test only cares about act normalization.
    bodyHolder.body = { subject_token: await signSubjectToken({ act: { sub: 'igor4-cb6bf26a+patrick+hofmann_eco@id.openape.ai' }, scope: [] }) }
    const result = await handler({})
    const minted = decodeMintedAct(result)
    expect(minted.act).toBe('agent')
    // provenance: the delegate sub from the act object rides along
    expect(minted.delegate).toBe('igor4-cb6bf26a+patrick+hofmann_eco@id.openape.ai')
  })

  it('keeps a plain human token human', async () => {
    bodyHolder.body = { subject_token: await signSubjectToken({ act: 'human' }) }
    const minted = decodeMintedAct(await handler({}))
    expect(minted.act).toBe('human')
    expect(minted.delegate).toBeNull()
  })

  it('fails closed to agent when act is absent', async () => {
    bodyHolder.body = { subject_token: await signSubjectToken() }
    expect(decodeMintedAct(await handler({})).act).toBe('agent')
  })
})
