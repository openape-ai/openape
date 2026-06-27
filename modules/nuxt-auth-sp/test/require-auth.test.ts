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

const { mockGetHeader, mockGetMethod, mockUseSession } = vi.hoisted(() => ({
  mockGetHeader: vi.fn(),
  mockGetMethod: vi.fn(),
  mockUseSession: vi.fn(),
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: vi.fn(() => ({
    openapeSp: { sessionSecret: SESSION_SECRET },
  })),
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

const event = {} as H3Event
const bearer = (token: string) => mockGetHeader.mockReturnValue(`Bearer ${token}`)

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
  mockUseSession.mockResolvedValue({ data: {} }) // no session → fall through to bearer
  mockGetMethod.mockReturnValue('GET')
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
})
