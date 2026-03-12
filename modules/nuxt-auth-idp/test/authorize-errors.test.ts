import { describe, expect, it, vi } from 'vitest'

const ISSUER = 'https://id.openape.at'
const REDIRECT_URI = 'https://sp.example.com/callback'

// Capture sendRedirect calls
const mockSendRedirect = vi.fn()

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  getQuery: vi.fn(),
  getRequestURL: () => new URL('https://id.openape.at/authorize'),
  sendRedirect: (...args: any[]) => mockSendRedirect(...args),
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), { statusCode: opts.statusCode }),
}))

vi.mock('../src/runtime/server/utils/stores', () => ({
  getIdpIssuer: () => ISSUER,
  useIdpStores: () => ({
    codeStore: { find: vi.fn(), save: vi.fn(), delete: vi.fn() },
  }),
}))

vi.mock('../src/runtime/server/utils/session', () => ({
  getAppSession: vi.fn(),
}))

vi.mock('../src/runtime/server/utils/agent-auth', () => ({
  tryAgentAuth: vi.fn().mockResolvedValue(null),
}))

vi.mock('../src/runtime/server/utils/grant-stores', () => ({
  useGrantStores: () => ({
    grantStore: {},
    challengeStore: {},
  }),
}))

vi.mock('@openape/core', () => ({
  extractDomain: vi.fn(),
  resolveDDISA: vi.fn().mockResolvedValue(null),
}))

vi.mock('@openape/grants', () => ({
  approveGrant: vi.fn(),
  createGrant: vi.fn(),
  useGrant: vi.fn(),
  validateDelegation: vi.fn(),
}))

describe('authorize endpoint — error redirects (RFC 6749 §4.1.2.1)', () => {
  it('redirects with error params when redirect_uri is valid', async () => {
    const { getQuery } = await import('h3')
    ;(getQuery as any).mockReturnValue({
      client_id: 'sp.example.com',
      redirect_uri: REDIRECT_URI,
      state: 'xyz',
      code_challenge: '', // missing → triggers validation error
      code_challenge_method: 'S256',
      nonce: 'n1',
      response_type: 'code',
    })

    const { default: handler } = await import('../src/runtime/server/routes/authorize.get')
    await handler({} as any)

    expect(mockSendRedirect).toHaveBeenCalled()
    const redirectUrl = new URL(mockSendRedirect.mock.calls[0][1])
    expect(redirectUrl.origin + redirectUrl.pathname).toBe(REDIRECT_URI)
    expect(redirectUrl.searchParams.get('error')).toBe('invalid_request')
    expect(redirectUrl.searchParams.get('state')).toBe('xyz')
  })

  it('throws createError when redirect_uri is missing', async () => {
    const { getQuery } = await import('h3')
    ;(getQuery as any).mockReturnValue({
      client_id: 'sp.example.com',
      redirect_uri: '', // missing
      state: 'xyz',
      code_challenge: '',
      code_challenge_method: 'S256',
      nonce: 'n1',
      response_type: 'code',
    })

    const { default: handler } = await import('../src/runtime/server/routes/authorize.get')

    await expect(handler({} as any)).rejects.toThrow()
  })
})
