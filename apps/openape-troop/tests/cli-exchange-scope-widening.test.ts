import type { JWK, KeyLike } from 'jose'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// /api/cli/exchange scope enforcement (#1035, protocol#6).
//
// A DELEGATED subject_token (RFC 8693 act OBJECT) must always state its
// own bounds via a `scope` claim — sp-data-access §5.2. A federated or
// older IdP can still mint delegated tokens WITHOUT scope; those must be
// rejected, not treated as "free choice from the catalog". And `scope: []`
// means "nothing", never "everything".
//
// First-party tokens (string act, no scope claim) stay unrestricted per
// sp-data-access §5.3 — the regression tests at the bottom pin that down.
//
// Same harness as cli-exchange-act.test.ts: real EdDSA signatures, only
// JWKS transport and DDISA issuer resolution stubbed.

const SECRET = 'troop-exchange-test-secret-32chars!!!'

const { jwksHolder, mockResolveIssuer } = vi.hoisted(() => ({
  jwksHolder: { keys: [] as JWK[] },
  mockResolveIssuer: vi.fn(),
}))

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

vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
vi.stubGlobal('setResponseStatus', vi.fn())
vi.stubGlobal('createError', (opts: { statusCode: number, statusMessage: string, data?: unknown }) =>
  Object.assign(new Error(opts.statusMessage), opts))
vi.stubGlobal('useRuntimeConfig', () => ({ openapeSp: { sessionSecret: SECRET, clientId: 'troop.openape.ai' } }))

const bodyHolder: { body: Record<string, unknown> } = { body: {} }
vi.stubGlobal('readBody', async () => bodyHolder.body)

const handler = (await import('../server/api/cli/exchange.post')).default as unknown as (event: unknown) => Promise<Record<string, unknown>>

const IDP_URL = 'https://id.openape.ai'
const idpPair = await generateKeyPair('EdDSA', { extractable: true })
const idpPriv: KeyLike = idpPair.privateKey
jwksHolder.keys.push({ ...(await exportJWK(idpPair.publicKey)), kid: 'idp-test-key', alg: 'EdDSA', use: 'sig' })

const DELEGATE = 'igor4-cb6bf26a+patrick+hofmann_eco@id.openape.ai'

async function signSubjectToken(claims: { act?: unknown, scope?: unknown } = {}): Promise<string> {
  const payload: Record<string, unknown> = {}
  if (claims.act !== undefined) payload.act = claims.act
  if (claims.scope !== undefined) payload.scope = claims.scope
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'EdDSA', kid: 'idp-test-key' })
    .setIssuer(IDP_URL)
    .setAudience('apes-cli')
    .setSubject('alice@openape.ai')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(idpPriv)
}

function decodeMintedScope(result: Record<string, unknown>): unknown {
  const [, payloadB64] = (result.access_token as string).split('.')
  return JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf-8')).scope
}

beforeEach(() => {
  mockResolveIssuer.mockResolvedValue({ sub: 'alice@openape.ai', issuer: IDP_URL, jwksUri: `${IDP_URL}/.well-known/jwks.json` })
})

describe('POST /api/cli/exchange — delegated scope enforcement (#1035)', () => {
  it('rejects a delegated token WITHOUT a scope claim (fail closed, 401)', async () => {
    bodyHolder.body = {
      subject_token: await signSubjectToken({ act: { sub: DELEGATE } }),
      scopes: ['troop:read-agents'],
    }
    await expect(handler({})).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects a delegated token WITHOUT a scope claim even when no scopes are requested', async () => {
    bodyHolder.body = { subject_token: await signSubjectToken({ act: { sub: DELEGATE } }) }
    await expect(handler({})).rejects.toMatchObject({ statusCode: 401 })
  })

  it('allows requesting exactly the granted scopes', async () => {
    bodyHolder.body = {
      subject_token: await signSubjectToken({ act: { sub: DELEGATE }, scope: ['troop:read-agents'] }),
      scopes: ['troop:read-agents'],
    }
    const result = await handler({})
    expect(result.scope).toEqual(['troop:read-agents'])
    expect(decodeMintedScope(result)).toEqual(['troop:read-agents'])
  })

  it('rejects widening beyond the granted scopes', async () => {
    bodyHolder.body = {
      subject_token: await signSubjectToken({ act: { sub: DELEGATE }, scope: ['troop:read-agents'] }),
      scopes: ['troop:read-agents', 'troop:spawn-agent'],
    }
    await expect(handler({})).rejects.toMatchObject({ statusCode: 400, statusMessage: 'invalid_scope' })
  })

  it('treats scope: [] as "nothing" — requesting any scope is widening', async () => {
    bodyHolder.body = {
      subject_token: await signSubjectToken({ act: { sub: DELEGATE }, scope: [] }),
      scopes: ['troop:read-agents'],
    }
    await expect(handler({})).rejects.toMatchObject({ statusCode: 400, statusMessage: 'invalid_scope' })
  })

  it('exchanges a scope: [] token when nothing is requested — minted token carries []', async () => {
    bodyHolder.body = {
      subject_token: await signSubjectToken({ act: { sub: DELEGATE }, scope: [] }),
    }
    const result = await handler({})
    expect(result.scope).toEqual([])
    expect(decodeMintedScope(result)).toEqual([])
  })
})

describe('POST /api/cli/exchange — first-party path unchanged (regression)', () => {
  it('act=human without scope claim may request any catalog scope', async () => {
    bodyHolder.body = {
      subject_token: await signSubjectToken({ act: 'human' }),
      scopes: ['troop:spawn-agent', 'troop:read-agents'],
    }
    const result = await handler({})
    expect(result.scope).toEqual(['troop:spawn-agent', 'troop:read-agents'])
    expect(decodeMintedScope(result)).toEqual(['troop:spawn-agent', 'troop:read-agents'])
  })

  it('act=human without scope claim and no requested scopes mints scope []', async () => {
    bodyHolder.body = { subject_token: await signSubjectToken({ act: 'human' }) }
    const result = await handler({})
    expect(result.scope).toEqual([])
  })

  it('unknown scopes are still rejected against the catalog', async () => {
    bodyHolder.body = {
      subject_token: await signSubjectToken({ act: 'human' }),
      scopes: ['troop:not-a-scope'],
    }
    await expect(handler({})).rejects.toMatchObject({ statusCode: 400, statusMessage: 'invalid_scope' })
  })
})
