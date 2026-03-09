import { describe, expect, it, vi } from 'vitest'

// Mock h3 (Nitro dependency, not available in unit tests)
vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
}))

// Mock the stores module
vi.mock('../src/runtime/server/utils/stores', () => ({
  getIdpIssuer: () => 'https://id.openape.at',
  useIdpStores: () => ({}),
}))

describe('oIDC discovery', () => {
  it('returns valid OIDC discovery document', async () => {
    const { default: handler } = await import('../src/runtime/server/routes/well-known/openid-configuration.get')
    const result = await handler({} as any)

    expect(result.issuer).toBe('https://id.openape.at')
    expect(result.authorization_endpoint).toBe('https://id.openape.at/authorize')
    expect(result.token_endpoint).toBe('https://id.openape.at/token')
    expect(result.jwks_uri).toBe('https://id.openape.at/.well-known/jwks.json')
    expect(result.response_types_supported).toEqual(['code'])
    expect(result.grant_types_supported).toEqual(['authorization_code', 'client_credentials', 'refresh_token'])
    expect(result.subject_types_supported).toEqual(['public'])
    expect(result.id_token_signing_alg_values_supported).toEqual(['ES256'])
    expect(result.code_challenge_methods_supported).toEqual(['S256'])
    expect(result.scopes_supported).toEqual(['openid', 'email', 'profile', 'offline_access'])
    expect(result.claims_supported).toContain('sub')
    expect(result.claims_supported).toContain('email')
    expect(result.claims_supported).toContain('name')
    expect(result.claims_supported).toContain('act')
    expect(result.claims_supported).toContain('authorization_details')
    expect(result.authorization_details_types_supported).toEqual(['openape_grant'])
    expect(result.token_endpoint_auth_methods_supported).toEqual(['none', 'private_key_jwt'])
    expect(result.token_endpoint_auth_signing_alg_values_supported).toEqual(['EdDSA', 'ES256'])
    expect(result.scopes_supported).toContain('offline_access')
    expect(result.revocation_endpoint).toBe('https://id.openape.at/revoke')
  })

  it('constructs all endpoints from issuer URL', async () => {
    const { default: handler } = await import('../src/runtime/server/routes/well-known/openid-configuration.get')
    const result = await handler({} as any)

    expect(result.authorization_endpoint).toMatch(/^https:\/\/id\.openape\.at\//)
    expect(result.token_endpoint).toMatch(/^https:\/\/id\.openape\.at\//)
    expect(result.jwks_uri).toMatch(/^https:\/\/id\.openape\.at\//)
  })
})

describe('jWKS endpoint', () => {
  it('returns keys array with required JWK fields', async () => {
    const { generateKeyPair } = await import('jose')

    // Mock keyStore that returns a real key
    const { publicKey } = await generateKeyPair('ES256')
    const kid = 'key-test-123'

    vi.doMock('../src/runtime/server/utils/stores', () => ({
      getIdpIssuer: () => 'https://id.openape.at',
      useIdpStores: () => ({
        keyStore: {
          getAllPublicKeys: async () => [{ kid, publicKey }],
        },
      }),
    }))

    // Also need to mock jose to re-use the real one
    vi.doMock('jose', async () => {
      const actual = await vi.importActual('jose')
      return actual
    })

    const { default: handler } = await import('../src/runtime/server/routes/well-known/jwks.json.get')
    const result = await handler({} as any)

    expect(result.keys).toBeInstanceOf(Array)
    expect(result.keys).toHaveLength(1)

    const key = result.keys[0]
    expect(key.kid).toBe('key-test-123')
    expect(key.alg).toBe('ES256')
    expect(key.use).toBe('sig')
    expect(key.kty).toBe('EC')
    expect(key.crv).toBe('P-256')
    expect(key.x).toBeTruthy()
    expect(key.y).toBeTruthy()
    // Must NOT contain private key material
    expect(key.d).toBeUndefined()
  })
})
