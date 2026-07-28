import type { H3Event } from 'h3'
import { SignJWT } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// requireCaller is the bearer/session gate in front of EVERY SP endpoint.
// These tests exercise it against REAL tokens: we mint with the real
// `signCliToken` and let `requireCaller` verify through the real
// `verifyCliToken` (real jose HS256). Only the runtime/transport seams are
// mocked — useRuntimeConfig (secret), getSpConfig (clientId), and the h3
// accessors getHeader/getMethod/useSession — so the security logic itself
// (signature, claim checks, scope enforcement) runs for real.

const SESSION_SECRET = 'test-session-secret-at-least-32-chars!!'
const CLIENT_ID = 'tasks.openape.ai'

const { mockGetHeader, mockGetMethod, mockUseSession, mockRuntimeConfig } = vi.hoisted(() => ({
  mockGetHeader: vi.fn(),
  mockGetMethod: vi.fn(),
  mockUseSession: vi.fn(),
  mockRuntimeConfig: vi.fn(),
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: mockRuntimeConfig,
}))

vi.mock('../src/runtime/server/utils/sp-config', () => ({
  getSpConfig: () => ({ clientId: CLIENT_ID }),
}))

vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>()
  return {
    ...actual,
    getHeader: (e: H3Event, n: string) => mockGetHeader(e, n),
    getMethod: (e: H3Event) => mockGetMethod(e),
    useSession: (e: H3Event, o: unknown) => mockUseSession(e, o),
  }
})

const { signCliToken } = await import('../src/runtime/server/utils/cli-token')
const { requireCaller } = await import('../src/runtime/server/utils/require-auth')

// The agent-token fallback ($fetch to the IdP verify endpoint) must never
// touch the network in unit tests — stub it to reject so any invalid CLI
// token deterministically ends in 401 rather than a real round-trip.
;(globalThis as Record<string, unknown>).$fetch = vi.fn().mockRejectedValue(new Error('no network in test'))

const event = { path: '/' } as H3Event
const bearer = (token: string) => mockGetHeader.mockReturnValue(`Bearer ${token}`)

function request(method: string, path = '/') {
  mockGetMethod.mockReturnValue(method)
  ;(event as { path: string }).path = path
}

/** Point useRuntimeConfig at an SP that publishes the given scope catalog. */
function withCatalog(scopes: Array<{ id: string, description: string, grants?: string[] }>) {
  mockRuntimeConfig.mockReturnValue({
    openapeSp: { sessionSecret: SESSION_SECRET, manifest: { scopes } },
  })
}

// Sign a raw CLI token directly — for edge cases signCliToken won't mint
// (empty scope array, deliberately-past expiry).
function rawCliToken(claims: Record<string, unknown>, opts: { expSeconds?: number } = {}) {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ typ: 'cli', ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(CLIENT_ID)
    .setAudience(CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(now + (opts.expSeconds ?? 300))
    .sign(new TextEncoder().encode(SESSION_SECRET))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRuntimeConfig.mockReturnValue({ openapeSp: { sessionSecret: SESSION_SECRET } }) // no manifest by default
  mockUseSession.mockResolvedValue({ data: {} }) // no session → fall through to bearer
  request('GET', '/')
  mockGetHeader.mockReturnValue(undefined)
})

describe('requireCaller — bearer (CLI token) path', () => {
  it('accepts a valid first-party token and returns the caller', async () => {
    const { token } = await signCliToken({ email: 'pat@example.com', act: 'human' })
    bearer(token)
    await expect(requireCaller(event)).resolves.toEqual({ email: 'pat@example.com', act: 'human' })
  })

  it('passes act=agent through unchanged', async () => {
    const { token } = await signCliToken({ email: 'bot@openape.ai', act: 'agent' })
    bearer(token)
    await expect(requireCaller(event)).resolves.toMatchObject({ act: 'agent' })
  })

  it('rejects a missing Authorization header with 401', async () => {
    await expect(requireCaller(event)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects a non-Bearer scheme with 401', async () => {
    mockGetHeader.mockReturnValue('Basic dXNlcjpwYXNz')
    await expect(requireCaller(event)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects a garbage bearer token with 401', async () => {
    bearer('not.a.jwt')
    await expect(requireCaller(event)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects a tampered signature with 401', async () => {
    const { token } = await signCliToken({ email: 'pat@example.com', act: 'human' })
    const tampered = `${token.slice(0, -2)}${token.endsWith('A') ? 'B' : 'A'}`
    bearer(tampered)
    await expect(requireCaller(event)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects an expired token with 401', async () => {
    const token = await rawCliToken({ sub: 'pat@example.com', email: 'pat@example.com', act: 'human' }, { expSeconds: -10 })
    bearer(token)
    await expect(requireCaller(event)).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe('requireCaller — session cookie path', () => {
  it('returns the caller from the session claims without a bearer token', async () => {
    mockUseSession.mockResolvedValue({ data: { claims: { email: 'human@openape.ai', act: 'human' } } })
    await expect(requireCaller(event)).resolves.toEqual({ email: 'human@openape.ai', act: 'human' })
  })

  it('reports an RFC 8693 delegation act OBJECT as agent, never human', async () => {
    mockUseSession.mockResolvedValue({ data: { claims: { email: 'human@openape.ai', act: { sub: 'agent@openape.ai' } } } })
    await expect(requireCaller(event)).resolves.toEqual({ email: 'human@openape.ai', act: 'agent' })
  })
})

describe('requireCaller — delegated scope enforcement', () => {
  it('accepts a read-scoped token on a GET', async () => {
    const { token } = await signCliToken({ email: 'bot@openape.ai', act: 'agent', scope: ['tasks:read'] })
    bearer(token)
    mockGetMethod.mockReturnValue('GET')
    await expect(requireCaller(event)).resolves.toMatchObject({ scope: ['tasks:read'] })
  })

  it('rejects a read-only token on a mutating POST with 403', async () => {
    const { token } = await signCliToken({ email: 'bot@openape.ai', act: 'agent', scope: ['tasks:read'] })
    bearer(token)
    mockGetMethod.mockReturnValue('POST')
    await expect(requireCaller(event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects a read-only token on a DELETE with 403', async () => {
    const { token } = await signCliToken({ email: 'bot@openape.ai', act: 'agent', scope: ['tasks:read'] })
    bearer(token)
    mockGetMethod.mockReturnValue('DELETE')
    await expect(requireCaller(event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects a delegated token carrying an empty scope with 403', async () => {
    const token = await rawCliToken({ sub: 'bot@openape.ai', email: 'bot@openape.ai', act: 'agent', scope: [] })
    bearer(token)
    await expect(requireCaller(event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('accepts a read+write token on a mutating POST', async () => {
    const { token } = await signCliToken({ email: 'bot@openape.ai', act: 'agent', scope: ['tasks:read', 'tasks:write'] })
    bearer(token)
    mockGetMethod.mockReturnValue('POST')
    await expect(requireCaller(event)).resolves.toMatchObject({ scope: ['tasks:read', 'tasks:write'] })
  })
})

// Exact catalog scopes (`<sp>:<action>`, sp-data-access.md §3.2) grant specific
// routes, not a read/write pair — the module must honor the SP's published
// catalog before falling back to the `<prefix>:read|write` convention (#1033,
// blocker found in #1047).
describe('requireCaller — catalog-aware scope enforcement', () => {
  const TROOP_CATALOG = [
    {
      id: 'troop:cockpit-serve',
      description: 'Serve cockpit agent tasks',
      grants: [
        'POST /api/cockpit/agent/tasks/next',
        'POST /api/cockpit/agent/tasks/resolve',
        'GET /api/cockpit/agent/skill/:id',
      ],
    },
    { id: 'troop:spawn-agent', description: 'Spawn agents', grants: ['POST /api/agents/spawn-intent'] },
  ]

  async function cockpitToken() {
    const { token } = await signCliToken({ email: 'bot@openape.ai', act: 'agent', scope: ['troop:cockpit-serve'] })
    bearer(token)
  }

  it('accepts an exact catalog scope on a POST route its grants cover', async () => {
    withCatalog(TROOP_CATALOG)
    await cockpitToken()
    request('POST', '/api/cockpit/agent/tasks/next')
    await expect(requireCaller(event)).resolves.toMatchObject({ scope: ['troop:cockpit-serve'] })
  })

  it('matches a :param grant segment against exactly one path segment', async () => {
    withCatalog(TROOP_CATALOG)
    await cockpitToken()
    request('GET', '/api/cockpit/agent/skill/abc123')
    await expect(requireCaller(event)).resolves.toMatchObject({ scope: ['troop:cockpit-serve'] })
  })

  it('does not let a :param segment swallow more than one segment', async () => {
    withCatalog(TROOP_CATALOG)
    await cockpitToken()
    request('GET', '/api/cockpit/agent/skill/abc123/extra')
    await expect(requireCaller(event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects a catalog scope on a route outside its grants with 403 naming held scopes', async () => {
    withCatalog(TROOP_CATALOG)
    await cockpitToken()
    request('POST', '/api/agents/spawn-intent')
    await expect(requireCaller(event)).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('troop:cockpit-serve'),
    })
  })

  it('matches grant methods case-insensitively', async () => {
    withCatalog([{ id: 'troop:cockpit-serve', description: 'x', grants: ['post /api/cockpit/agent/tasks/next'] }])
    await cockpitToken()
    request('POST', '/api/cockpit/agent/tasks/next')
    await expect(requireCaller(event)).resolves.toMatchObject({ scope: ['troop:cockpit-serve'] })
  })

  it('keeps the read/write convention as fallback for scopes without a catalog entry', async () => {
    withCatalog(TROOP_CATALOG)
    const { token } = await signCliToken({ email: 'bot@openape.ai', act: 'agent', scope: ['tasks:read'] })
    bearer(token)
    request('GET', '/api/tasks')
    await expect(requireCaller(event)).resolves.toMatchObject({ scope: ['tasks:read'] })
  })

  it('rejects an empty scope with 403 even when a catalog is published', async () => {
    withCatalog(TROOP_CATALOG)
    const token = await rawCliToken({ sub: 'bot@openape.ai', email: 'bot@openape.ai', act: 'agent', scope: [] })
    bearer(token)
    request('POST', '/api/cockpit/agent/tasks/next')
    await expect(requireCaller(event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('passes a first-party token (no scope claim) through unchecked', async () => {
    withCatalog(TROOP_CATALOG)
    const { token } = await signCliToken({ email: 'pat@example.com', act: 'human' })
    bearer(token)
    request('POST', '/api/agents/spawn-intent')
    await expect(requireCaller(event)).resolves.toEqual({ email: 'pat@example.com', act: 'human' })
  })
})
