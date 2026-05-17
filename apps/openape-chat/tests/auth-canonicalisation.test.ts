import { describe, expect, it, vi } from 'vitest'

// Pin the email-case canonicalisation in resolveCaller (#282). The
// identity returned to every downstream handler is lower-cased exactly
// once at this boundary; if it ever stops, contacts-canonicalisation +
// memberships + bridge allowlist drift apart and authz checks
// silently disagree on whether `Foo@x.com` and `foo@x.com` are the
// same user.

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  createError: (opts: any) =>
    Object.assign(new Error(opts.statusMessage), { statusCode: opts.statusCode }),
}))

// Auto-imported globals in nuxt-server land — stub them so the module
// can be imported under vitest.
;(globalThis as any).getHeader = vi.fn().mockReturnValue(null)
;(globalThis as any).getQuery = vi.fn().mockReturnValue({})
;(globalThis as any).getSpSession = vi.fn()
;(globalThis as any).createError = (opts: any) =>
  Object.assign(new Error(opts.statusMessage), { statusCode: opts.statusCode })
;(globalThis as any).useRuntimeConfig = () => ({ public: { idpUrl: 'https://id.openape.ai' } })

vi.mock('@openape/core', () => ({
  createRemoteJWKS: vi.fn(),
  verifyJWT: vi.fn(async () => ({ payload: { sub: 'Foo@X.com', act: 'human' } })),
}))

vi.mock('jose', () => ({
  decodeProtectedHeader: vi.fn(() => ({ alg: 'EdDSA' })),
}))

vi.mock('../server/utils/cli-token', () => ({
  verifyCliToken: vi.fn(async () => ({ email: 'Foo@X.com', act: 'human' })),
}))

describe('resolveCaller email canonicalisation (#282)', () => {
  it('lower-cases the cookie-session sub claim', async () => {
    ;(globalThis as any).getSpSession = vi.fn(async () => ({
      data: { claims: { sub: 'Foo@X.com', act: 'human' } },
    }))
    const { resolveCaller } = await import('../server/utils/auth')
    const caller = await resolveCaller({} as any)
    expect(caller.email).toBe('foo@x.com')
    expect(caller.source).toBe('cookie')
  })

  it('lower-cases the bearer-JWT sub claim', async () => {
    ;(globalThis as any).getHeader = vi.fn((_event, name: string) =>
      name.toLowerCase() === 'authorization' ? 'Bearer eyJhbGciOiJFZERTQSJ9.fake' : null,
    )
    ;(globalThis as any).getQuery = vi.fn(() => ({}))
    const { resolveCaller } = await import('../server/utils/auth')
    const caller = await resolveCaller({} as any)
    expect(caller.email).toBe('foo@x.com')
    expect(caller.source).toBe('bearer')
  })
})
