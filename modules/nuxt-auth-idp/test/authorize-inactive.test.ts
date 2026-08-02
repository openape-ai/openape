// Follow-up to the isActive enforcement on the login paths (#1144):
// a deactivated user must not be able to keep using a PRE-EXISTING
// browser session (or bearer token) on /authorize. Without a per-access
// check, deactivation only stops future logins while live sessions keep
// minting authorization codes until they expire.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ISSUER = 'https://id.openape.at'
const REDIRECT_URI = 'https://app.example.com/auth/callback'

const mockSendRedirect = vi.fn()
const sessionUpdate = vi.fn(async () => {})
const findUserByEmailMock = vi.fn()
let sessionData: Record<string, unknown> = {}

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  getQuery: vi.fn(),
  getRequestURL: () => new URL('https://id.openape.at/authorize'),
  sendRedirect: (...args: any[]) => mockSendRedirect(...args),
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), { statusCode: opts.statusCode }),
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: vi.fn(() => ({
    openapeIdp: { spMetadataMode: 'permissive', publicClients: '' },
  })),
}))

vi.mock('../src/runtime/server/utils/stores', () => ({
  getIdpIssuer: () => ISSUER,
  useIdpStores: vi.fn(() => ({
    codeStore: { find: vi.fn(), save: vi.fn(), delete: vi.fn() },
    clientMetadataStore: { resolve: async () => null },
    consentStore: { hasConsent: async () => true, save: vi.fn() },
    adminAllowlistStore: { isAllowed: async () => false },
    userStore: { findByEmail: findUserByEmailMock },
  })),
}))

vi.mock('../src/runtime/server/utils/session', () => ({
  getAppSession: vi.fn(async () => ({
    data: sessionData,
    update: sessionUpdate,
  })),
}))

vi.mock('../src/runtime/server/utils/agent-auth', () => ({
  tryBearerAuth: vi.fn().mockResolvedValue(null),
  tryAgentAuth: vi.fn().mockResolvedValue(null),
}))

vi.mock('../src/runtime/server/utils/grant-stores', () => ({
  useGrantStores: () => ({ grantStore: {}, challengeStore: {} }),
}))

vi.mock('../src/runtime/server/utils/problem', () => ({
  createProblemError: (opts: any) =>
    Object.assign(new Error(opts.title), { statusCode: opts.status, data: opts }),
}))

vi.mock('@openape/core', () => ({
  extractDomain: () => 'example.com',
  resolveDDISA: vi.fn(async () => ({
    version: 'ddisa1',
    idp: ISSUER,
    mode: 'open',
    raw: `v=ddisa1 idp=${ISSUER}; mode=open`,
  })),
  createProblemDetails: (opts: any) => ({ ...opts, type: opts.type ?? 'about:blank' }),
}))

vi.mock('@openape/auth', () => ({
  validateAuthorizeRequest: () => null,
  validateRedirectUri: async () => null,
  evaluatePolicy: vi.fn(async () => 'allow'),
}))

vi.mock('@openape/grants', () => ({
  approveGrant: vi.fn(),
  createGrant: vi.fn(),
  useGrant: vi.fn(),
  validateDelegation: vi.fn(),
}))

beforeEach(() => {
  mockSendRedirect.mockClear()
  sessionUpdate.mockClear()
  findUserByEmailMock.mockReset()
  sessionData = { userId: 'alice@example.com', userName: 'Alice' }
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function callAuthorize(query: Record<string, string> = {}) {
  const { getQuery } = await import('h3')
  ;(getQuery as any).mockReturnValue({
    client_id: 'app.example.com',
    redirect_uri: REDIRECT_URI,
    state: 'xyz',
    code_challenge: 'abc'.repeat(15),
    code_challenge_method: 'S256',
    nonce: 'n1',
    response_type: 'code',
    ...query,
  })
  const { default: handler } = await import('../src/runtime/server/routes/authorize.get')
  return await handler({} as any)
}

describe('authorize.get — deactivated user with live credentials', () => {
  it('refuses a deactivated user with a live browser session (403)', async () => {
    findUserByEmailMock.mockResolvedValue({
      email: 'alice@example.com',
      name: 'Alice',
      isActive: false,
    })

    await expect(callAuthorize()).rejects.toMatchObject({
      statusCode: 403,
      message: 'User is inactive',
    })
    expect(mockSendRedirect).not.toHaveBeenCalled()
  })

  it('refuses a deactivated user presenting a still-valid bearer token (403)', async () => {
    const { tryBearerAuth } = await import('../src/runtime/server/utils/agent-auth')
    ;(tryBearerAuth as any).mockResolvedValue({ sub: 'alice@example.com' })
    findUserByEmailMock.mockResolvedValue({
      email: 'alice@example.com',
      name: 'Alice',
      isActive: false,
    })

    await expect(callAuthorize()).rejects.toMatchObject({
      statusCode: 403,
      message: 'User is inactive',
    })
    expect(mockSendRedirect).not.toHaveBeenCalled()
  })

  it('still authorizes an active user with a live session', async () => {
    findUserByEmailMock.mockResolvedValue({
      email: 'alice@example.com',
      name: 'Alice',
      isActive: true,
    })

    await callAuthorize()

    expect(mockSendRedirect).toHaveBeenCalled()
    const redirectUrl = new URL(mockSendRedirect.mock.calls[0]![1])
    expect(redirectUrl.searchParams.get('code')).toBeTruthy()
  })

  it('does not block identities unknown to the userStore (SSH-key-only)', async () => {
    // Same conservative shape as #1144: only an EXISTING user with
    // isActive === false is refused; unknown identities pass through.
    findUserByEmailMock.mockResolvedValue(undefined)

    await callAuthorize()

    expect(mockSendRedirect).toHaveBeenCalled()
    const redirectUrl = new URL(mockSendRedirect.mock.calls[0]![1])
    expect(redirectUrl.searchParams.get('code')).toBeTruthy()
  })
})
