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
  tryBearerAuth: vi.fn().mockResolvedValue(null),
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
  createProblemDetails: (opts: any) => ({
    type: opts.type ?? 'about:blank',
    title: opts.title,
    status: opts.status,
    detail: opts.detail,
  }),
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

  it('rejects authorization_details on /authorize (CSRF-able auto-approve removed, #273)', async () => {
    // Pin the security fix: the historical implementation auto-approved
    // arbitrary RFC 9396 authorization_details whenever the parameter was
    // present, treating an existing IdP session as implicit consent. A
    // crafted URL could therefore approve broad CLI grants via top-level
    // GET navigation. The handler now refuses the parameter outright;
    // callers must use POST /api/grants + POST /api/grants/{id}/approve.
    const { getQuery } = await import('h3')
    ;(getQuery as any).mockReturnValue({
      client_id: 'sp.example.com',
      redirect_uri: REDIRECT_URI,
      state: 'xyz',
      code_challenge: 'abc'.repeat(15), // valid 43-char placeholder
      code_challenge_method: 'S256',
      nonce: 'n1',
      response_type: 'code',
      authorization_details: JSON.stringify([
        {
          type: 'openape_cli',
          cli_id: 'rm',
          operation_id: 'rm.delete',
          permission: 'rm.filesystem[*]#delete',
          action: 'delete',
        },
      ]),
    })

    // Authenticated session needed to reach the authorization_details
    // gate (it sits AFTER session resolution + policy evaluation).
    const { getAppSession } = await import('../src/runtime/server/utils/session')
    ;(getAppSession as any).mockResolvedValue({
      data: { userId: 'patrick@hofmann.eco' },
      update: vi.fn(),
    })

    const { default: handler } = await import('../src/runtime/server/routes/authorize.get')

    await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('still passes through when authorization_details is empty/whitespace', async () => {
    // Empty / whitespace-only must not fall into the rejection path —
    // SPs that always include the parameter (with `[]`) should keep
    // working. Validation error on missing code_challenge fires first,
    // proving the authorize flow itself was reached.
    const { getQuery } = await import('h3')
    ;(getQuery as any).mockReturnValue({
      client_id: 'sp.example.com',
      redirect_uri: REDIRECT_URI,
      state: 'xyz',
      code_challenge: '', // triggers earlier validation redirect
      code_challenge_method: 'S256',
      nonce: 'n1',
      response_type: 'code',
      authorization_details: '   ',
    })

    mockSendRedirect.mockClear()
    const { default: handler } = await import('../src/runtime/server/routes/authorize.get')
    await handler({} as any)

    expect(mockSendRedirect).toHaveBeenCalled()
    const redirectUrl = new URL(mockSendRedirect.mock.calls[0][1])
    expect(redirectUrl.searchParams.get('error')).toBe('invalid_request')
  })
})
