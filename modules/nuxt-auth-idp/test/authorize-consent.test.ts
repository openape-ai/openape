import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Pin the DDISA `allowlist-user` policy mode flow (#301):
//   - decision === 'consent' redirects to /consent (not access_denied)
//   - consent.post.ts requires CSRF + writes to ConsentStore + resumes /authorize
//   - cancel returns access_denied to the SP
//   - existing 'allow' / 'deny' branches still work

const ISSUER = 'https://id.openape.at'
const REDIRECT_URI = 'https://app.example.com/auth/callback'

const mockSendRedirect = vi.fn()
const consentSave = vi.fn(async () => {})
const sessionUpdate = vi.fn(async () => {})
let sessionData = {}
let pendingConsent
let evaluatePolicyResult = 'allow'

vi.mock('h3', () => ({
  defineEventHandler: fn => fn,
  getQuery: vi.fn(),
  getRequestURL: () => new URL('https://id.openape.at/authorize'),
  sendRedirect: (...args) => mockSendRedirect(...args),
  readBody: vi.fn(),
  createError: opts => Object.assign(new Error(opts.statusMessage), { statusCode: opts.statusCode }),
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
    consentStore: {
      hasConsent: async () => false,
      save: consentSave,
    },
    adminAllowlistStore: { isAllowed: async () => false },
  })),
}))

vi.mock('../src/runtime/server/utils/session', () => ({
  getAppSession: vi.fn(async () => ({
    data: { ...sessionData, pendingConsent },
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
  createProblemError: opts =>
    Object.assign(new Error(opts.title), { statusCode: opts.status, data: opts }),
}))

vi.mock('@openape/core', () => ({
  extractDomain: () => 'hofmann.eco',
  resolveDDISA: vi.fn(),
  createProblemDetails: opts => ({ ...opts, type: opts.type ?? 'about:blank' }),
}))

vi.mock('@openape/auth', () => ({
  validateAuthorizeRequest: () => null,
  validateRedirectUri: async () => null,
  evaluatePolicy: vi.fn(async () => evaluatePolicyResult),
}))

vi.mock('@openape/grants', () => ({
  approveGrant: vi.fn(),
  createGrant: vi.fn(),
  useGrant: vi.fn(),
  validateDelegation: vi.fn(),
}))

beforeEach(() => {
  mockSendRedirect.mockClear()
  consentSave.mockClear()
  sessionUpdate.mockClear()
  sessionData = { userId: 'patrick@hofmann.eco', userName: 'Patrick' }
  pendingConsent = undefined
  evaluatePolicyResult = 'allow'
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function callAuthorize(query = {}) {
  const { getQuery } = await import('h3')
  ;(getQuery).mockReturnValue({
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

describe('authorize.get — DDISA allowlist-user flow (#301)', () => {
  it('redirects to /consent when policy decision === \'consent\' (not access_denied)', async () => {
    evaluatePolicyResult = 'consent'

    await callAuthorize()

    expect(sessionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      pendingConsent: expect.objectContaining({
        params: expect.objectContaining({ client_id: 'app.example.com' }),
        csrfToken: expect.any(String),
      }),
    }))
    expect(mockSendRedirect).toHaveBeenCalled()
    const target = mockSendRedirect.mock.calls[0][1]
    // Either absolute URL or pathname-only — we accept both forms.
    expect(target).toMatch(/\/consent\?/)
    expect(target).toContain('client_id=app.example.com')
  })

  it('returns access_denied when policy decision === \'deny\' (unchanged behaviour)', async () => {
    evaluatePolicyResult = 'deny'
    await callAuthorize()
    const target = mockSendRedirect.mock.calls[0][1]
    expect(target).toMatch(/^https:\/\/app\.example\.com\/auth\/callback\?error=access_denied/)
  })

  it('proceeds to code issuance when decision === \'allow\'', async () => {
    evaluatePolicyResult = 'allow'
    await callAuthorize()
    const target = mockSendRedirect.mock.calls[0][1]
    expect(target).toMatch(/^https:\/\/app\.example\.com\/auth\/callback\?code=/)
  })

  it('passes undefined mode to evaluatePolicy when DDISA record is missing — not \'open\' (#305)', async () => {
    // DDISA core.md §5.6 recommends prompting for consent when the
    // DNS record is silent. Defaulting to 'open' would silently issue
    // assertions for any user without a `_ddisa` TXT record, which is
    // the inverse of what a missing record should mean.
    const { resolveDDISA } = await import('@openape/core')
    ;(resolveDDISA as any).mockResolvedValue(null)
    const { evaluatePolicy } = await import('@openape/auth')
    await callAuthorize()
    expect(evaluatePolicy).toHaveBeenCalledWith(undefined, 'app.example.com', 'patrick@hofmann.eco', expect.anything(), expect.objectContaining({ adminAllowlistStore: expect.anything() }))
  })

  it('passes undefined mode when DDISA record exists but `mode` field is omitted (#305)', async () => {
    const { resolveDDISA } = await import('@openape/core')
    ;(resolveDDISA as any).mockResolvedValue({ version: 'ddisa1', idp: 'https://id.openape.at', raw: 'v=ddisa1 idp=...' })
    const { evaluatePolicy } = await import('@openape/auth')
    await callAuthorize()
    expect(evaluatePolicy).toHaveBeenCalledWith(undefined, 'app.example.com', 'patrick@hofmann.eco', expect.anything(), expect.objectContaining({ adminAllowlistStore: expect.anything() }))
  })

  it('passes through explicit mode=open when DNS sets it — opt-in is honoured (#305)', async () => {
    const { resolveDDISA } = await import('@openape/core')
    ;(resolveDDISA as any).mockResolvedValue({ version: 'ddisa1', idp: 'https://id.openape.at', mode: 'open', raw: 'v=ddisa1 mode=open ...' })
    const { evaluatePolicy } = await import('@openape/auth')
    await callAuthorize()
    expect(evaluatePolicy).toHaveBeenCalledWith('open', 'app.example.com', 'patrick@hofmann.eco', expect.anything(), expect.objectContaining({ adminAllowlistStore: expect.anything() }))
  })
})

describe('consent.post — approve/cancel/csrf', () => {
  beforeEach(() => {
    pendingConsent = {
      params: { client_id: 'app.example.com', redirect_uri: REDIRECT_URI, state: 'xyz' },
      query: {
        client_id: 'app.example.com',
        redirect_uri: REDIRECT_URI,
        state: 'xyz',
        code_challenge: 'abc'.repeat(15),
        code_challenge_method: 'S256',
        response_type: 'code',
      },
      csrfToken: 'tok-good',
      createdAt: Date.now(),
    }
  })

  async function postConsent(body): Promise<{ location?: string } | undefined> {
    const { readBody } = await import('h3')
    ;(readBody).mockResolvedValue(body)
    const { default: handler } = await import('../src/runtime/server/api/authorize/consent.post')
    return await handler({ node: { req: { url: '/api/authorize/consent' } } } as any)
  }

  it('saves consent and returns the resume URL in JSON on approve with valid CSRF', async () => {
    const res = await postConsent({ csrfToken: 'tok-good', action: 'approve' })

    expect(consentSave).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'patrick@hofmann.eco',
      clientId: 'app.example.com',
    }))
    expect(sessionUpdate).toHaveBeenCalledWith({ pendingConsent: undefined })
    expect(res?.location).toMatch(/\/authorize\?/)
    expect(res?.location).toContain('client_id=app.example.com')
  })

  it('rejects on missing/wrong CSRF', async () => {
    await expect(postConsent({ csrfToken: 'wrong', action: 'approve' }))
      .rejects
      .toMatchObject({ statusCode: 403 })
    expect(consentSave).not.toHaveBeenCalled()
  })

  it('returns access_denied redirect to redirect_uri on cancel', async () => {
    const res = await postConsent({ csrfToken: 'tok-good', action: 'cancel' })

    expect(consentSave).not.toHaveBeenCalled()
    expect(res?.location).toMatch(/^https:\/\/app\.example\.com\/auth\/callback\?error=access_denied/)
    expect(res?.location).toContain('state=xyz')
  })

  it('rejects expired consent state (older than 5 min)', async () => {
    pendingConsent.createdAt = Date.now() - 10 * 60_000 // 10 min ago
    await expect(postConsent({ csrfToken: 'tok-good', action: 'approve' }))
      .rejects
      .toMatchObject({ statusCode: 400 })
    // Pending should be cleared
    expect(sessionUpdate).toHaveBeenCalledWith({ pendingConsent: undefined })
  })

  it('rejects when no pending consent exists in session', async () => {
    pendingConsent = undefined
    await expect(postConsent({ csrfToken: 'tok-good', action: 'approve' }))
      .rejects
      .toMatchObject({ statusCode: 400 })
  })
})
