// Issue #1035: delegated access tokens minted via /api/oauth/token-exchange
// must carry a `scope` claim mirroring the delegation grant's scopes —
// otherwise downstream SPs cannot tell "first-party, unrestricted" apart
// from "delegated, scopes lost".
import type { KeyLike } from 'jose'
import { generateKeyPair, jwtVerify, SignJWT } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ISSUER = 'https://id.openape.at'
const DELEGATE_EMAIL = 'agent+nest@id.openape.at'
const DELEGATOR_EMAIL = 'alice@example.com'
const TOKEN_EXCHANGE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange'

let idpSigningKey: { privateKey: KeyLike, publicKey: KeyLike, kid: string }

const mockKeyStore = {
  getSigningKey: vi.fn(),
  getAllPublicKeys: vi.fn(),
}

async function setup() {
  const kp = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
  idpSigningKey = { ...kp, kid: 'idp-key-1' }
  mockKeyStore.getSigningKey.mockResolvedValue(idpSigningKey)
}

// Mock h3 — the handler only needs these primitives
vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  readBody: vi.fn(),
  setHeader: vi.fn(),
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), { statusCode: opts.statusCode }),
}))

vi.mock('../src/runtime/server/utils/stores', () => ({
  getIdpIssuer: () => ISSUER,
  useIdpStores: () => ({
    keyStore: mockKeyStore,
  }),
}))

const mockGrantStore = {
  findById: vi.fn(),
  listGrants: vi.fn(),
}

vi.mock('../src/runtime/server/utils/grant-stores', () => ({
  useGrantStores: () => ({
    grantStore: mockGrantStore,
    challengeStore: {},
  }),
}))

/** IdP-issued agent access token (the delegate's own token). */
async function buildActorToken(): Promise<string> {
  return new SignJWT({ act: 'agent' })
    .setProtectedHeader({ alg: 'EdDSA', kid: idpSigningKey.kid })
    .setIssuer(ISSUER)
    .setSubject(DELEGATE_EMAIL)
    .setAudience('apes-cli')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(idpSigningKey.privateKey)
}

function buildDelegationGrant(overrides: { scopes?: string[] } = {}) {
  return {
    id: 'grant-1035',
    type: 'delegation',
    status: 'approved',
    request: {
      requester: DELEGATOR_EMAIL,
      target_host: 'id.openape.at',
      audience: '*',
      delegator: DELEGATOR_EMAIL,
      delegate: DELEGATE_EMAIL,
      ...('scopes' in overrides ? { scopes: overrides.scopes } : {}),
    },
    created_at: 1000,
  }
}

async function callExchange(body: Record<string, string>) {
  const { readBody } = await import('h3')
  ;(readBody as any).mockResolvedValue(body)
  const { default: handler } = await import('../src/runtime/server/api/oauth/token-exchange.post')
  return handler({} as any)
}

async function decode(accessToken: string) {
  const { payload } = await jwtVerify(accessToken, idpSigningKey.publicKey, { algorithms: ['EdDSA'] })
  return payload
}

describe('token-exchange scope claim (issue #1035)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mirrors the delegation grant scopes into the token', async () => {
    await setup()
    mockGrantStore.findById.mockResolvedValue(
      buildDelegationGrant({ scopes: ['tasks:read', 'tasks:write'] }),
    )

    const result = await callExchange({
      grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
      actor_token: await buildActorToken(),
      delegation_grant_id: 'grant-1035',
    })

    const payload = await decode(result.access_token)
    expect(payload.sub).toBe(DELEGATOR_EMAIL)
    expect(payload.act).toEqual({ sub: DELEGATE_EMAIL })
    expect(payload.delegation_grant).toBe('grant-1035')
    expect(payload.scope).toEqual(['tasks:read', 'tasks:write'])
  })

  it('writes scope: [] for legacy grants without scopes (fail-closed)', async () => {
    await setup()
    mockGrantStore.findById.mockResolvedValue(buildDelegationGrant())

    const result = await callExchange({
      grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
      actor_token: await buildActorToken(),
      delegation_grant_id: 'grant-1035',
    })

    const payload = await decode(result.access_token)
    // [] means "nothing allowed", never "everything allowed" — a delegated
    // token must always state its own limits.
    expect(payload.scope).toEqual([])
  })

  it('mirrors scopes on the subject_token-only path too', async () => {
    await setup()
    mockGrantStore.listGrants.mockResolvedValue({
      data: [buildDelegationGrant({ scopes: ['mail:send'] })],
    })
    const subjectToken = await new SignJWT({ act: 'human' })
      .setProtectedHeader({ alg: 'EdDSA', kid: idpSigningKey.kid })
      .setIssuer(ISSUER)
      .setSubject(DELEGATOR_EMAIL)
      .setAudience('apes-cli')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(idpSigningKey.privateKey)

    const result = await callExchange({
      grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
      actor_token: await buildActorToken(),
      subject_token: subjectToken,
    })

    const payload = await decode(result.access_token)
    expect(payload.scope).toEqual(['mail:send'])
  })
})
