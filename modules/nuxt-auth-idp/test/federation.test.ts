import { describe, expect, it, vi } from 'vitest'

// Mock storage instance
const mockStorage = new Map<string, unknown>()
const mockStorageInstance = {
  getItem: vi.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: unknown) => { mockStorage.set(key, value) }),
  removeItem: vi.fn(async (key: string) => { mockStorage.delete(key) }),
  getKeys: vi.fn(async () => [...mockStorage.keys()]),
}

// Mock nitropack/runtime
vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({
    openapeIdp: {
      federationProviders: JSON.stringify([
        {
          id: 'google',
          type: 'oidc',
          issuer: 'https://accounts.google.com',
          clientId: 'google-client-id',
          clientSecret: 'google-secret',
          scopes: ['openid', 'email', 'profile'],
        },
        {
          id: 'keycloak',
          type: 'oidc',
          issuer: 'https://keycloak.firma.at/realms/main',
          clientId: 'kc-client',
          clientSecret: 'kc-secret',
        },
      ]),
      sessionSecret: 'test-secret-at-least-32-characters-long',
      storageKey: 'test',
    },
  }),
  useEvent: vi.fn().mockReturnValue(null),
  useStorage: () => mockStorageInstance,
}))

// Mock h3
vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  getQuery: vi.fn().mockReturnValue({}),
  getRequestURL: vi.fn().mockReturnValue(new URL('https://id.openape.at')),
  getRouterParam: vi.fn().mockReturnValue('google'),
  sendRedirect: vi.fn().mockImplementation((_e: any, url: string) => url),
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), { statusCode: opts.statusCode }),
  useSession: vi.fn().mockResolvedValue({ data: {}, update: vi.fn() }),
}))

// Mock #imports (unused but required for some transitive imports)
vi.mock('#imports', () => ({}))

describe('federation utilities', () => {
  it('getFederationProviders parses config', async () => {
    const { getFederationProviders } = await import('../src/runtime/server/utils/federation')
    const providers = getFederationProviders()

    expect(providers).toHaveLength(2)
    expect(providers[0].id).toBe('google')
    expect(providers[0].issuer).toBe('https://accounts.google.com')
    expect(providers[0].clientId).toBe('google-client-id')
    expect(providers[1].id).toBe('keycloak')
  })

  it('findProvider returns matching provider', async () => {
    const { findProvider } = await import('../src/runtime/server/utils/federation')
    const p = findProvider('google')

    expect(p).not.toBeNull()
    expect(p!.id).toBe('google')
    expect(p!.clientId).toBe('google-client-id')
  })

  it('findProvider returns null for unknown', async () => {
    const { findProvider } = await import('../src/runtime/server/utils/federation')
    expect(findProvider('unknown')).toBeNull()
  })

  it('fetchOidcDiscovery fetches and caches', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        issuer: 'https://accounts.google.com',
        authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        token_endpoint: 'https://oauth2.googleapis.com/token',
        jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { fetchOidcDiscovery } = await import('../src/runtime/server/utils/federation')

    const disc = await fetchOidcDiscovery('https://accounts.google.com')
    expect(disc.authorization_endpoint).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(disc.token_endpoint).toBe('https://oauth2.googleapis.com/token')
    expect(mockFetch).toHaveBeenCalledTimes(1)

    // Second call should use cache
    await fetchOidcDiscovery('https://accounts.google.com')
    expect(mockFetch).toHaveBeenCalledTimes(1)

    vi.unstubAllGlobals()
  })
})

describe('federation providers endpoint', () => {
  it('returns public provider list (id + name)', async () => {
    const { default: handler } = await import('../src/runtime/server/api/federation/providers.get')
    const result = await handler({} as any)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ id: 'google', name: 'Google' })
    expect(result[1]).toEqual({ id: 'keycloak', name: 'Keycloak' })
  })

  it('does not expose clientSecret', async () => {
    const { default: handler } = await import('../src/runtime/server/api/federation/providers.get')
    const result = await handler({} as any)

    for (const p of result) {
      expect(p).not.toHaveProperty('clientSecret')
      expect(p).not.toHaveProperty('clientId')
      expect(p).not.toHaveProperty('issuer')
    }
  })
})

describe('federation redirect route', () => {
  it('redirects to external IdP with PKCE params', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        issuer: 'https://accounts.google.com',
        authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        token_endpoint: 'https://oauth2.googleapis.com/token',
        jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { sendRedirect } = await import('h3')

    const { default: handler } = await import('../src/runtime/server/routes/auth/federated/[providerId].get')
    await handler({} as any)

    expect(sendRedirect).toHaveBeenCalled()
    const redirectUrl = (sendRedirect as any).mock.calls[0][1] as string
    const url = new URL(redirectUrl)

    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.pathname).toBe('/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('google-client-id')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(url.searchParams.get('state')).toBeTruthy()
    expect(url.searchParams.get('redirect_uri')).toBe('https://id.openape.at/auth/federated/google/callback')

    // Federation state saved
    expect(mockStorageInstance.setItem).toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('throws for unknown provider', async () => {
    const { getRouterParam } = await import('h3')
    ;(getRouterParam as any).mockReturnValueOnce('nonexistent')

    const { default: handler } = await import('../src/runtime/server/routes/auth/federated/[providerId].get')
    await expect(handler({} as any)).rejects.toThrow('Unknown federation provider')
  })
})
