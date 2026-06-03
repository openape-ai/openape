import { describe, expect, it, vi } from 'vitest'
import { SignJWT } from 'jose'

// `cli-token.ts` imports `useRuntimeConfig` from `nitropack/runtime` — this
// virtual package is only available inside a running Nitro server. Mock the
// entire module so vitest can import the util directly.
vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: vi.fn(() => ({
    openapeSp: { sessionSecret: 'test-session-secret-at-least-32-chars!!' },
  })),
}))

const SESSION_SECRET = 'test-session-secret-at-least-32-chars!!'
const CLIENT_ID = 'chat.openape.ai'

// `createError` is an h3 global auto-imported by Nuxt/Nitro at runtime.
;(globalThis as any).createError = (opts: { statusCode: number, statusMessage: string }) =>
  Object.assign(new Error(opts.statusMessage), { statusCode: opts.statusCode })

// getSpConfig() is imported by cli-token.ts — mock it to return our test values.
vi.mock('../src/runtime/server/utils/sp-config', () => ({
  getSpConfig: () => ({ clientId: CLIENT_ID }),
}))

const { signCliToken, verifyCliToken } = await import('../src/runtime/server/utils/cli-token')

describe('signCliToken', () => {
  it('mints a JWT with the configured issuer and audience', async () => {
    const { token } = await signCliToken({ email: 'pat@example.com', act: 'human' })
    const [, payloadB64] = token.split('.')
    const payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf-8'))
    expect(payload.iss).toBe(CLIENT_ID)
    expect(payload.aud).toBe(CLIENT_ID)
    expect(payload.sub).toBe('pat@example.com')
    expect(payload.email).toBe('pat@example.com')
    expect(payload.act).toBe('human')
    expect(payload.typ).toBe('cli')
  })

  it('sets exp ~30 days from now by default', async () => {
    const before = Math.floor(Date.now() / 1000)
    const { expiresAt } = await signCliToken({ email: 'pat@example.com', act: 'agent' })
    const after = Math.floor(Date.now() / 1000)
    const thirtyDays = 30 * 24 * 3600
    expect(expiresAt).toBeGreaterThanOrEqual(before + thirtyDays)
    expect(expiresAt).toBeLessThanOrEqual(after + thirtyDays + 2)
  })

  it('respects a custom ttlSeconds', async () => {
    const before = Math.floor(Date.now() / 1000)
    const { expiresAt } = await signCliToken({ email: 'pat@example.com', act: 'human', ttlSeconds: 60 })
    const after = Math.floor(Date.now() / 1000)
    expect(expiresAt).toBeGreaterThanOrEqual(before + 60)
    expect(expiresAt).toBeLessThanOrEqual(after + 62)
  })
})

describe('verifyCliToken', () => {
  it('returns the payload for a valid token', async () => {
    const { token } = await signCliToken({ email: 'alice@example.com', act: 'agent' })
    const result = await verifyCliToken(token)
    expect(result).not.toBeNull()
    expect(result!.email).toBe('alice@example.com')
    expect(result!.act).toBe('agent')
  })

  it('returns null for a token with the wrong signing key', async () => {
    const wrongKey = new TextEncoder().encode('totally-different-secret-at-least-32chars')
    const token = await new SignJWT({ typ: 'cli', sub: 'x@y.com', email: 'x@y.com', act: 'human' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(CLIENT_ID)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(wrongKey)
    const result = await verifyCliToken(token)
    expect(result).toBeNull()
  })

  it('returns null when typ claim is not "cli"', async () => {
    const key = new TextEncoder().encode(SESSION_SECRET)
    const token = await new SignJWT({ typ: 'session', sub: 'x@y.com', email: 'x@y.com', act: 'human' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(CLIENT_ID)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(key)
    const result = await verifyCliToken(token)
    expect(result).toBeNull()
  })

  it('returns null for an expired token', async () => {
    const key = new TextEncoder().encode(SESSION_SECRET)
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({ typ: 'cli', sub: 'x@y.com', email: 'x@y.com', act: 'human' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(CLIENT_ID)
      .setAudience(CLIENT_ID)
      .setIssuedAt(now - 120)
      .setExpirationTime(now - 60)
      .sign(key)
    const result = await verifyCliToken(token)
    expect(result).toBeNull()
  })
})
