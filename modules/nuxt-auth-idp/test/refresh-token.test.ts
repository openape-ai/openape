import type { KeyLike } from 'jose'
import { generateKeyPair, jwtVerify } from 'jose'
import { describe, expect, it, vi } from 'vitest'

const ISSUER = 'https://id.openape.at'

let idpSigningKey: { privateKey: KeyLike, publicKey: KeyLike, kid: string }

async function setup() {
  const kp = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
  idpSigningKey = { ...kp, kid: 'idp-key-1' }
}

// Mock h3
vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  readRawBody: vi.fn(),
  getRequestHeader: vi.fn(),
  setResponseStatus: vi.fn(),
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), { statusCode: opts.statusCode }),
}))

const mockRefreshTokenStore = {
  create: vi.fn(),
  consume: vi.fn(),
  revokeByToken: vi.fn(),
  revokeFamily: vi.fn(),
  revokeByUser: vi.fn(),
  listFamilies: vi.fn(),
}

const mockCodeStore = { find: vi.fn(), save: vi.fn(), delete: vi.fn() }
const mockKeyStore = { getSigningKey: vi.fn(), getAllPublicKeys: vi.fn() }
const mockUserStore = { findByEmail: vi.fn() }
const mockSshKeyStore = { findByUser: vi.fn(), findByPublicKey: vi.fn() }
const mockJtiStore = { hasBeenUsed: vi.fn().mockResolvedValue(false), markUsed: vi.fn() }

vi.mock('../src/runtime/server/utils/stores', () => ({
  getIdpIssuer: () => ISSUER,
  useIdpStores: () => ({
    codeStore: mockCodeStore,
    keyStore: mockKeyStore,
    userStore: mockUserStore,
    sshKeyStore: mockSshKeyStore,
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

describe('refresh_token grant', () => {
  it('exchanges refresh token for new token set', async () => {
    await setup()
    mockKeyStore.getSigningKey.mockResolvedValue(idpSigningKey)
    mockRefreshTokenStore.consume.mockResolvedValue({
      newToken: 'new-refresh-token',
      userId: 'alice@example.com',
      clientId: 'sp.example.com',
      familyId: 'fam-1',
    })
    mockUserStore.findByEmail.mockResolvedValue({
      email: 'alice@example.com',
      name: 'Alice',
    })

    const { readRawBody } = await import('h3')
    ;(readRawBody as any).mockResolvedValue(JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: 'old-refresh-token',
      client_id: 'sp.example.com',
    }))

    const { default: handler } = await import('../src/runtime/server/routes/token.post')
    const result = await handler({} as any)

    expect(result.access_token).toBeTruthy()
    expect(result.id_token).toBeTruthy()
    expect(result.refresh_token).toBe('new-refresh-token')
    expect(result.token_type).toBe('Bearer')
    expect(result.expires_in).toBe(300)

    const { payload } = await jwtVerify(result.access_token, idpSigningKey.publicKey, {
      algorithms: ['EdDSA'],
    })
    expect(payload.sub).toBe('alice@example.com')
    expect(payload.aud).toBe('sp.example.com')
  })

  it('rejects missing refresh_token', async () => {
    const { readRawBody } = await import('h3')
    ;(readRawBody as any).mockResolvedValue(JSON.stringify({
      grant_type: 'refresh_token',
      client_id: 'sp.example.com',
    }))

    const { default: handler } = await import('../src/runtime/server/routes/token.post')
    const result = await handler({} as any)

    expect(result.error).toBe('invalid_request')
    expect(result.error_description).toContain('refresh_token')
  })

  it('rejects missing client_id', async () => {
    const { readRawBody } = await import('h3')
    ;(readRawBody as any).mockResolvedValue(JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: 'some-token',
    }))

    const { default: handler } = await import('../src/runtime/server/routes/token.post')
    const result = await handler({} as any)

    expect(result.error).toBe('invalid_request')
    expect(result.error_description).toContain('client_id')
  })

  it('rejects invalid refresh token', async () => {
    mockRefreshTokenStore.consume.mockRejectedValue(new Error('Invalid refresh token'))

    const { readRawBody } = await import('h3')
    ;(readRawBody as any).mockResolvedValue(JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: 'invalid-token',
      client_id: 'sp.example.com',
    }))

    const { default: handler } = await import('../src/runtime/server/routes/token.post')
    const result = await handler({} as any)

    expect(result.error).toBe('invalid_grant')
    expect(result.error_description).toContain('Invalid refresh token')
  })
})

describe('revocation endpoint', () => {
  it('revokes a refresh token', async () => {
    mockRefreshTokenStore.revokeByToken.mockResolvedValue(undefined)

    const { readRawBody } = await import('h3')
    ;(readRawBody as any).mockResolvedValue(JSON.stringify({
      token: 'some-refresh-token',
    }))

    const { default: handler } = await import('../src/runtime/server/routes/revoke.post')
    const result = await handler({} as any)

    expect(result.status).toBe('ok')
    expect(mockRefreshTokenStore.revokeByToken).toHaveBeenCalledWith('some-refresh-token')
  })

  it('accepts form-urlencoded body', async () => {
    mockRefreshTokenStore.revokeByToken.mockResolvedValue(undefined)

    const { readRawBody, getRequestHeader } = await import('h3')
    ;(getRequestHeader as any).mockReturnValueOnce('application/x-www-form-urlencoded')
    ;(readRawBody as any).mockResolvedValue('token=some-refresh-token')

    const { default: handler } = await import('../src/runtime/server/routes/revoke.post')
    const result = await handler({} as any)

    expect(result.status).toBe('ok')
    expect(mockRefreshTokenStore.revokeByToken).toHaveBeenCalledWith('some-refresh-token')
  })

  it('returns ok even for invalid token (RFC 7009)', async () => {
    mockRefreshTokenStore.revokeByToken.mockRejectedValue(new Error('Not found'))

    const { readRawBody } = await import('h3')
    ;(readRawBody as any).mockResolvedValue(JSON.stringify({
      token: 'invalid-token',
    }))

    const { default: handler } = await import('../src/runtime/server/routes/revoke.post')
    const result = await handler({} as any)

    expect(result.status).toBe('ok')
  })
})
