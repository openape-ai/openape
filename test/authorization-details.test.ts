import type { KeyLike } from 'jose'
import { generateKeyPair, jwtVerify } from 'jose'
import { describe, expect, it, vi } from 'vitest'

const ISSUER = 'https://id.openape.at'

let idpSigningKey: { privateKey: KeyLike, publicKey: KeyLike, kid: string }

async function setup() {
  const kp = await generateKeyPair('ES256')
  idpSigningKey = { ...kp, kid: 'idp-key-1' }
}

// Mock h3
vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  readRawBody: vi.fn(),
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), { statusCode: opts.statusCode }),
}))

const mockCodeStore = { find: vi.fn(), save: vi.fn(), delete: vi.fn() }
const mockKeyStore = { getSigningKey: vi.fn(), getAllPublicKeys: vi.fn() }
const mockUserStore = { findByEmail: vi.fn() }
const mockAgentStore = { findByEmail: vi.fn() }
const mockJtiStore = { hasBeenUsed: vi.fn().mockResolvedValue(false), markUsed: vi.fn() }
const mockRefreshTokenStore = {
  create: vi.fn(),
  consume: vi.fn(),
  revokeByToken: vi.fn(),
  revokeFamily: vi.fn(),
  revokeByUser: vi.fn(),
  listFamilies: vi.fn(),
}

vi.mock('../src/runtime/server/utils/stores', () => ({
  getIdpIssuer: () => ISSUER,
  useIdpStores: () => ({
    codeStore: mockCodeStore,
    keyStore: mockKeyStore,
    userStore: mockUserStore,
    agentStore: mockAgentStore,
    jtiStore: mockJtiStore,
    refreshTokenStore: mockRefreshTokenStore,
  }),
}))

vi.mock('../src/runtime/server/utils/ed25519', () => ({
  sshEd25519ToKeyObject: vi.fn(),
}))

vi.mock('../src/runtime/server/utils/agent-token', () => ({
  issueAgentToken: vi.fn().mockResolvedValue('mock-agent-jwt'),
}))

// Mock grant-stores (imports nitropack/runtime which is unavailable in tests)
vi.mock('../src/runtime/server/utils/grant-stores', () => ({
  useGrantStores: () => ({
    grantStore: {},
    challengeStore: {},
  }),
}))

describe('authorization_details in token response', () => {
  it('includes authorization_details when code entry has them', async () => {
    await setup()
    mockKeyStore.getSigningKey.mockResolvedValue(idpSigningKey)

    const authzDetails = [
      { type: 'openape_grant', action: 'Transfer:Create', approval: 'once', grant_id: 'grant-123' },
    ]

    mockCodeStore.find.mockResolvedValue({
      code: 'test-code',
      clientId: 'sp.example.com',
      redirectUri: 'https://sp.example.com/callback',
      codeChallenge: 'valid-challenge',
      userId: 'alice@example.com',
      nonce: 'test-nonce',
      expiresAt: Date.now() + 60000,
      authorizationDetails: authzDetails,
    })
    mockCodeStore.delete.mockResolvedValue(undefined)
    mockUserStore.findByEmail.mockResolvedValue({
      email: 'alice@example.com',
      name: 'Alice',
    })

    // Mock PKCE
    const { generateCodeChallenge } = await import('@openape/core')
    const challenge = await generateCodeChallenge('test-verifier')
    mockCodeStore.find.mockResolvedValue({
      code: 'test-code',
      clientId: 'sp.example.com',
      redirectUri: 'https://sp.example.com/callback',
      codeChallenge: challenge,
      userId: 'alice@example.com',
      nonce: 'test-nonce',
      expiresAt: Date.now() + 60000,
      authorizationDetails: authzDetails,
    })

    const { readRawBody } = await import('h3')
    ;(readRawBody as any).mockResolvedValue(JSON.stringify({
      grant_type: 'authorization_code',
      code: 'test-code',
      code_verifier: 'test-verifier',
      redirect_uri: 'https://sp.example.com/callback',
      client_id: 'sp.example.com',
    }))

    const { default: handler } = await import('../src/runtime/server/routes/token.post')
    const result = await handler({} as any)

    // Token response includes authorization_details
    expect(result.authorization_details).toEqual(authzDetails)
    expect(result.access_token).toBeTruthy()

    // JWT includes authorization_details claim
    const { payload } = await jwtVerify(result.access_token, idpSigningKey.publicKey, {
      algorithms: ['ES256'],
    })
    expect(payload.authorization_details).toEqual(authzDetails)
  })

  it('omits authorization_details when code entry has none', async () => {
    await setup()
    mockKeyStore.getSigningKey.mockResolvedValue(idpSigningKey)

    const { generateCodeChallenge } = await import('@openape/core')
    const challenge = await generateCodeChallenge('test-verifier-2')

    mockCodeStore.find.mockResolvedValue({
      code: 'no-authz-code',
      clientId: 'sp.example.com',
      redirectUri: 'https://sp.example.com/callback',
      codeChallenge: challenge,
      userId: 'alice@example.com',
      nonce: 'test-nonce',
      expiresAt: Date.now() + 60000,
    })
    mockCodeStore.delete.mockResolvedValue(undefined)
    mockUserStore.findByEmail.mockResolvedValue({
      email: 'alice@example.com',
      name: 'Alice',
    })

    const { readRawBody } = await import('h3')
    ;(readRawBody as any).mockResolvedValue(JSON.stringify({
      grant_type: 'authorization_code',
      code: 'no-authz-code',
      code_verifier: 'test-verifier-2',
      redirect_uri: 'https://sp.example.com/callback',
      client_id: 'sp.example.com',
    }))

    const { default: handler } = await import('../src/runtime/server/routes/token.post')
    const result = await handler({} as any)

    expect(result.authorization_details).toBeUndefined()

    const { payload } = await jwtVerify(result.access_token, idpSigningKey.publicKey, {
      algorithms: ['ES256'],
    })
    expect(payload.authorization_details).toBeUndefined()
  })
})
