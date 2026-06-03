import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

// ── Hoisted stubs (vi.hoisted runs before any vi.mock factory) ────────────────

const { mockSetResponseStatus, mockJwtVerify, mockResolveIssuer, mockReadBody } = vi.hoisted(() => ({
  mockSetResponseStatus: vi.fn(),
  mockJwtVerify: vi.fn(),
  mockResolveIssuer: vi.fn(),
  mockReadBody: vi.fn(),
}))

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: vi.fn(() => ({
    openapeSp: { sessionSecret: 'exchange-test-secret-at-least-32-chars!!' },
  })),
}))

vi.mock('../src/runtime/server/utils/sp-config', () => ({
  getSpConfig: () => ({ clientId: 'chat.openape.ai' }),
}))

vi.mock('../src/runtime/server/utils/ddisa-issuer', () => ({
  resolveIssuerForToken: (token: string) => mockResolveIssuer(token),
}))

vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>()
  return {
    ...actual,
    createRemoteJWKSet: vi.fn(() => 'mock-jwks-keyset'),
    jwtVerify: (_token: unknown, _keys: unknown, _opts: unknown) => mockJwtVerify(_token),
  }
})

vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>()
  return {
    ...actual,
    readBody: mockReadBody,
    setResponseStatus: mockSetResponseStatus,
    defineEventHandler: (fn: (event: H3Event) => unknown) => fn,
    createError: (opts: { statusCode: number, statusMessage: string, data?: unknown }) =>
      Object.assign(new Error(opts.statusMessage), opts),
  }
})

// ── Import factory under test ─────────────────────────────────────────────────

;(globalThis as any).createError = (opts: { statusCode: number, statusMessage: string, data?: unknown }) =>
  Object.assign(new Error(opts.statusMessage), opts)

const { createCliExchangeHandler } = await import('../src/runtime/server/utils/cli-exchange')
const fakeEvent = {} as H3Event
const CLIENT_ID = 'chat.openape.ai'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createCliExchangeHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveIssuer.mockResolvedValue({
      sub: 'alice@openape.ai',
      issuer: 'https://id.openape.ai',
      jwksUri: 'https://id.openape.ai/.well-known/jwks.json',
    })
    mockJwtVerify.mockResolvedValue({
      payload: { sub: 'alice@openape.ai', act: 'human', iss: 'https://id.openape.ai', aud: 'apes-cli' },
    })
  })

  it('returns 400 when subject_token is missing', async () => {
    mockReadBody.mockResolvedValue({})
    const handler = createCliExchangeHandler()
    await expect(handler(fakeEvent)).rejects.toMatchObject({ statusCode: 400, message: 'subject_token required' })
  })

  it('returns 401 when DDISA resolution returns null (no usable sub)', async () => {
    mockReadBody.mockResolvedValue({ subject_token: 'bad.token.here' })
    mockResolveIssuer.mockResolvedValue(null)
    const handler = createCliExchangeHandler()
    await expect(handler(fakeEvent)).rejects.toMatchObject({
      statusCode: 401,
      message: 'subject_token has no usable subject claim',
    })
  })

  it('returns 401 when IdP signature verification fails', async () => {
    mockReadBody.mockResolvedValue({ subject_token: 'valid.looking.token' })
    mockJwtVerify.mockRejectedValue(new Error('signature verification failed'))
    const handler = createCliExchangeHandler()
    await expect(handler(fakeEvent)).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid subject_token',
    })
  })

  it('returns 401 when verified sub is not an email address', async () => {
    mockReadBody.mockResolvedValue({ subject_token: 'valid.looking.token' })
    mockJwtVerify.mockResolvedValue({
      payload: { sub: 'not-an-email', act: 'human', iss: 'https://id.openape.ai', aud: 'apes-cli' },
    })
    const handler = createCliExchangeHandler()
    await expect(handler(fakeEvent)).rejects.toMatchObject({
      statusCode: 401,
      message: 'subject_token has no usable subject claim',
    })
  })

  it('mints an SP token and returns 201 on success', async () => {
    mockReadBody.mockResolvedValue({ subject_token: 'valid.looking.token' })
    const handler = createCliExchangeHandler()
    const result = await handler(fakeEvent) as Record<string, unknown>
    expect(mockSetResponseStatus).toHaveBeenCalledWith(fakeEvent, 201)
    expect(result.token_type).toBe('Bearer')
    expect(result.aud).toBe(CLIENT_ID)
    expect(typeof result.access_token).toBe('string')
    expect(typeof result.expires_at).toBe('number')
    expect(result.scopes).toBeUndefined()
  })

  it('echoes scopes from the request body when provided', async () => {
    mockReadBody.mockResolvedValue({ subject_token: 'valid.looking.token', scopes: ['chat:read', 'chat:write'] })
    const handler = createCliExchangeHandler()
    const result = await handler(fakeEvent) as Record<string, unknown>
    expect(result.scopes).toEqual(['chat:read', 'chat:write'])
  })

  it('maps act=agent from IdP claim to the SP token', async () => {
    mockReadBody.mockResolvedValue({ subject_token: 'valid.looking.token' })
    mockJwtVerify.mockResolvedValue({
      payload: { sub: 'bot@openape.ai', act: 'agent', iss: 'https://id.openape.ai', aud: 'apes-cli' },
    })
    mockResolveIssuer.mockResolvedValue({
      sub: 'bot@openape.ai',
      issuer: 'https://id.openape.ai',
      jwksUri: 'https://id.openape.ai/.well-known/jwks.json',
    })
    const handler = createCliExchangeHandler()
    const result = await handler(fakeEvent) as Record<string, unknown>
    const token = result.access_token as string
    const [, payloadB64] = token.split('.')
    const payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf-8'))
    expect(payload.act).toBe('agent')
  })
})
