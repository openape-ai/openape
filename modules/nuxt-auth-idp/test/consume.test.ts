import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock grant data
const mockGrants = new Map<string, any>()

// Mock @openape/grants
vi.mock('@openape/grants', () => ({
  introspectGrant: vi.fn(async (id: string) => mockGrants.get(id) ?? null),
  useGrant: vi.fn(async (id: string) => {
    const grant = mockGrants.get(id)
    if (!grant) throw new Error(`Grant not found: ${id}`)
    grant.status = 'used'
    grant.used_at = Math.floor(Date.now() / 1000)
    return grant
  }),
  verifyAuthzJWT: vi.fn(async (_token: string) => ({
    valid: true,
    claims: { grant_id: 'grant-1', sub: 'agent@example.com' },
  })),
}))

// Mock h3
const mockHeaders = new Map<string, string>()
vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  getRouterParam: vi.fn().mockReturnValue('grant-1'),
  getHeader: vi.fn((_e: any, name: string) => mockHeaders.get(name)),
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), { statusCode: opts.statusCode }),
}))

// Mock stores
vi.mock('../src/runtime/server/utils/stores', () => ({
  useIdpStores: () => ({
    keyStore: {
      getSigningKey: async () => ({
        publicKey: 'mock-public-key',
        privateKey: 'mock-private-key',
        kid: 'kid-1',
      }),
    },
  }),
}))

// Mock grant-stores
vi.mock('../src/runtime/server/utils/grant-stores', () => ({
  useGrantStores: () => ({
    grantStore: {
      findById: async (id: string) => mockGrants.get(id) ?? null,
      updateStatus: vi.fn(),
    },
  }),
}))

// Mock nitropack/runtime
vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ openapeIdp: {} }),
  useEvent: vi.fn(),
  useStorage: vi.fn(),
}))

describe('grant consume endpoint', () => {
  beforeEach(() => {
    mockGrants.clear()
    mockHeaders.clear()
  })

  it('consumes a once grant successfully', async () => {
    mockHeaders.set('authorization', 'Bearer valid-jwt')
    mockGrants.set('grant-1', {
      id: 'grant-1',
      status: 'approved',
      request: { requester: 'agent@example.com', grant_type: 'once', target_host: 'server', audience: 'escapes' },
    })

    const { default: handler } = await import('../src/runtime/server/api/grants/[id]/consume.post')
    const result = await handler({} as any)

    expect(result.status).toBe('consumed')
  })

  it('validates timed grant without consuming', async () => {
    mockHeaders.set('authorization', 'Bearer valid-jwt')
    mockGrants.set('grant-1', {
      id: 'grant-1',
      status: 'approved',
      request: { requester: 'agent@example.com', grant_type: 'timed', target_host: 'server', audience: 'escapes' },
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    })

    const { default: handler } = await import('../src/runtime/server/api/grants/[id]/consume.post')
    const result = await handler({} as any)

    expect(result.status).toBe('valid')
  })

  it('validates always grant without consuming', async () => {
    mockHeaders.set('authorization', 'Bearer valid-jwt')
    mockGrants.set('grant-1', {
      id: 'grant-1',
      status: 'approved',
      request: { requester: 'agent@example.com', grant_type: 'always', target_host: 'server', audience: 'escapes' },
    })

    const { default: handler } = await import('../src/runtime/server/api/grants/[id]/consume.post')
    const result = await handler({} as any)

    expect(result.status).toBe('valid')
  })

  it('rejects already consumed grant', async () => {
    mockHeaders.set('authorization', 'Bearer valid-jwt')
    mockGrants.set('grant-1', {
      id: 'grant-1',
      status: 'used',
      request: { requester: 'agent@example.com', grant_type: 'once', target_host: 'server', audience: 'escapes' },
    })

    const { default: handler } = await import('../src/runtime/server/api/grants/[id]/consume.post')
    const result = await handler({} as any)

    expect(result.error).toBe('already_consumed')
  })

  it('rejects revoked grant', async () => {
    mockHeaders.set('authorization', 'Bearer valid-jwt')
    mockGrants.set('grant-1', {
      id: 'grant-1',
      status: 'revoked',
      request: { requester: 'agent@example.com', grant_type: 'once', target_host: 'server', audience: 'escapes' },
    })

    const { default: handler } = await import('../src/runtime/server/api/grants/[id]/consume.post')
    const result = await handler({} as any)

    expect(result.error).toBe('revoked')
  })

  it('rejects without authorization header', async () => {
    // No auth header set
    const { default: handler } = await import('../src/runtime/server/api/grants/[id]/consume.post')

    await expect(handler({} as any)).rejects.toThrow('Missing or invalid Authorization header')
  })

  it('rejects when JWT verification fails', async () => {
    mockHeaders.set('authorization', 'Bearer invalid-jwt')

    // Override verifyAuthzJWT to return invalid
    const { verifyAuthzJWT } = await import('@openape/grants')
    ;(verifyAuthzJWT as any).mockResolvedValueOnce({ valid: false, error: 'Invalid signature' })

    const { default: handler } = await import('../src/runtime/server/api/grants/[id]/consume.post')

    await expect(handler({} as any)).rejects.toThrow('Invalid grant token')
  })
})
