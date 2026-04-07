import { describe, expect, it, vi } from 'vitest'

const ISSUER = 'https://id.openape.at'

// Mock h3 with getRequestHeader and setResponseStatus
const mockGetRequestHeader = vi.fn()
const mockSetResponseStatus = vi.fn()

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  readRawBody: vi.fn(),
  getRequestHeader: (...args: any[]) => mockGetRequestHeader(...args),
  setResponseStatus: (...args: any[]) => mockSetResponseStatus(...args),
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), { statusCode: opts.statusCode }),
}))

// Mock stores
const mockCodeStore = { find: vi.fn(), save: vi.fn(), delete: vi.fn() }
const mockKeyStore = { getSigningKey: vi.fn(), getAllPublicKeys: vi.fn() }
const mockUserStore = { findByEmail: vi.fn() }
const mockSshKeyStore = { findByUser: vi.fn(), findByPublicKey: vi.fn() }
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

vi.mock('../src/runtime/server/utils/grant-stores', () => ({
  useGrantStores: () => ({
    grantStore: {},
    challengeStore: {},
  }),
}))

describe('token endpoint — RFC 6749 compliance', () => {
  it('accepts application/x-www-form-urlencoded body', async () => {
    const { readRawBody } = await import('h3')
    mockGetRequestHeader.mockReturnValue('application/x-www-form-urlencoded')
    ;(readRawBody as any).mockResolvedValue('grant_type=authorization_code&code=test&code_verifier=abc&redirect_uri=https://example.com/cb&client_id=example.com')

    mockCodeStore.find.mockResolvedValue(null) // code not found → invalid_grant

    const { default: handler } = await import('../src/runtime/server/routes/token.post')
    const result = await handler({} as any)

    // Should parse the body and attempt exchange (fails with invalid_grant, not JSON parse error)
    expect(result.error).toBe('invalid_grant')
  })

  it('returns { error: "invalid_grant" } for invalid auth code', async () => {
    const { readRawBody } = await import('h3')
    mockGetRequestHeader.mockReturnValue('application/x-www-form-urlencoded')
    ;(readRawBody as any).mockResolvedValue('grant_type=authorization_code&code=bad-code&code_verifier=abc&redirect_uri=https://example.com/cb&client_id=example.com')

    mockCodeStore.find.mockResolvedValue(null)

    const { default: handler } = await import('../src/runtime/server/routes/token.post')
    const result = await handler({} as any)

    expect(result.error).toBe('invalid_grant')
    expect(result.error_description).toBeTruthy()
  })

  it('returns { error: "unsupported_grant_type" } for unknown grant type', async () => {
    const { readRawBody } = await import('h3')
    mockGetRequestHeader.mockReturnValue('application/x-www-form-urlencoded')
    ;(readRawBody as any).mockResolvedValue('grant_type=password&username=alice&password=secret')

    const { default: handler } = await import('../src/runtime/server/routes/token.post')
    const result = await handler({} as any)

    expect(result.error).toBe('unsupported_grant_type')
    expect(result.error_description).toBeTruthy()
  })

  it('returns { error: "invalid_request" } for missing required fields', async () => {
    const { readRawBody } = await import('h3')
    mockGetRequestHeader.mockReturnValue('application/json')
    ;(readRawBody as any).mockResolvedValue(JSON.stringify({
      grant_type: 'authorization_code',
      code: 'some-code',
      // missing code_verifier, redirect_uri, client_id
    }))

    const { default: handler } = await import('../src/runtime/server/routes/token.post')
    const result = await handler({} as any)

    expect(result.error).toBe('invalid_request')
    expect(result.error_description).toContain('Missing required fields')
  })

  it('returns { error: "invalid_client" } for failed client credentials', async () => {
    const { readRawBody } = await import('h3')
    mockGetRequestHeader.mockReturnValue('application/json')
    ;(readRawBody as any).mockResolvedValue(JSON.stringify({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: 'invalid-jwt',
    }))

    const { default: handler } = await import('../src/runtime/server/routes/token.post')
    const result = await handler({} as any)

    expect(result.error).toBe('invalid_client')
    expect(result.error_description).toBeTruthy()
  })

  it('returns { error: "invalid_request" } for missing refresh_token', async () => {
    const { readRawBody } = await import('h3')
    mockGetRequestHeader.mockReturnValue('application/json')
    ;(readRawBody as any).mockResolvedValue(JSON.stringify({
      grant_type: 'refresh_token',
      client_id: 'sp.example.com',
    }))

    const { default: handler } = await import('../src/runtime/server/routes/token.post')
    const result = await handler({} as any)

    expect(result.error).toBe('invalid_request')
    expect(result.error_description).toContain('refresh_token')
  })

  it('sets HTTP status 400 for invalid_request errors', async () => {
    const { readRawBody } = await import('h3')
    mockGetRequestHeader.mockReturnValue('application/json')
    ;(readRawBody as any).mockResolvedValue(JSON.stringify({
      grant_type: 'authorization_code',
      code: 'x',
      // missing fields
    }))

    const { default: handler } = await import('../src/runtime/server/routes/token.post')
    await handler({} as any)

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 400)
  })

  it('sets HTTP status 401 for invalid_client errors', async () => {
    const { readRawBody } = await import('h3')
    mockGetRequestHeader.mockReturnValue('application/json')
    ;(readRawBody as any).mockResolvedValue(JSON.stringify({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: 'bad-jwt',
    }))

    const { default: handler } = await import('../src/runtime/server/routes/token.post')
    await handler({} as any)

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 401)
  })
})
