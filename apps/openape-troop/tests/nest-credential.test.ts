import { beforeAll, describe, expect, it } from 'vitest'
import { signCliToken, verifyCliToken } from '../server/utils/cli-token'
import {
  generateDeviceSecret,
  hashDeviceSecret,
  NEST_DEVICE_SCOPES,
  NEST_TOKEN_TTL_SECONDS,
} from '../server/utils/nest-credential'

// cli-token.ts reads two Nuxt auto-imported globals at call time. Stub them
// so the mint round-trip can run under the plain-node vitest env.
beforeAll(() => {
  ;(globalThis as Record<string, unknown>).useRuntimeConfig = () => ({
    openapeSp: { sessionSecret: 'x'.repeat(48) },
  })
  ;(globalThis as Record<string, unknown>).createError = (e: unknown) => new Error(JSON.stringify(e))
})

describe('nest device credential', () => {
  it('generates a high-entropy, url-safe secret', () => {
    const s = generateDeviceSecret()
    expect(s).toMatch(/^[\w-]+$/)
    // 32 random bytes → 43 base64url chars
    expect(s.length).toBeGreaterThanOrEqual(43)
  })

  it('generates distinct secrets each call', () => {
    const set = new Set(Array.from({ length: 100 }, () => generateDeviceSecret()))
    expect(set.size).toBe(100)
  })

  it('hashes deterministically and diverges per secret', () => {
    const a = generateDeviceSecret()
    expect(hashDeviceSecret(a)).toBe(hashDeviceSecret(a))
    expect(hashDeviceSecret(a)).not.toBe(hashDeviceSecret(generateDeviceSecret()))
    expect(hashDeviceSecret(a)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('device scopes are operational only — never nest:bind', () => {
    expect(NEST_DEVICE_SCOPES).toContain('nest:spawn-agent')
    expect(NEST_DEVICE_SCOPES).toContain('nest:report-status')
    expect(NEST_DEVICE_SCOPES).not.toContain('nest:bind')
  })
})

describe('session-less device token mint (M4δ-3 core)', () => {
  it('mints a bounded, owner-attributed agent token a device can present', async () => {
    const hostId = 'mbp-home'
    const owner = 'patrick@example.com'

    // This is exactly what POST /api/nests/token mints after matching the
    // device secret against the active nest row — no IdP round-trip, no
    // session, fully non-interactive.
    const { token, expiresAt } = await signCliToken({
      email: owner,
      act: 'agent',
      scope: [...NEST_DEVICE_SCOPES],
      delegate: `nest:${hostId}`,
      ttlSeconds: NEST_TOKEN_TTL_SECONDS,
    })

    const claims = await verifyCliToken(token)
    expect(claims).not.toBeNull()
    expect(claims!.sub).toBe(owner)
    expect(claims!.act).toBe('agent')
    expect(claims!.scope).toEqual([...NEST_DEVICE_SCOPES])
    expect(claims!.delegate).toBe(`nest:${hostId}`)
    // Short-lived by design: the cap is enforced, not the 30-day first-party TTL.
    expect(expiresAt - claims!.iat).toBeLessThanOrEqual(NEST_TOKEN_TTL_SECONDS)
  })
})
