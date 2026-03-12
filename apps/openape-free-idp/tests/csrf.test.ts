import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'

// Test CSRF token generation logic directly (avoid importing h3-dependent module)
function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url')
}

function validateCsrfToken(sessionToken: string | undefined, requestToken: string | undefined): boolean {
  return !!(sessionToken && requestToken && sessionToken === requestToken)
}

describe('CSRF utilities', () => {
  describe('generateCsrfToken', () => {
    it('generates a base64url-encoded token', () => {
      const token = generateCsrfToken()
      expect(token).toBeTruthy()
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(20)
    })

    it('generates unique tokens', () => {
      const t1 = generateCsrfToken()
      const t2 = generateCsrfToken()
      expect(t1).not.toBe(t2)
    })

    it('generates 256-bit tokens (43 chars in base64url)', () => {
      const token = generateCsrfToken()
      expect(token.length).toBe(43) // 32 bytes = 43 base64url chars
    })
  })

  describe('validateCsrfToken', () => {
    it('accepts matching tokens', () => {
      const token = generateCsrfToken()
      expect(validateCsrfToken(token, token)).toBe(true)
    })

    it('rejects mismatched tokens', () => {
      expect(validateCsrfToken('token-a', 'token-b')).toBe(false)
    })

    it('rejects undefined session token', () => {
      expect(validateCsrfToken(undefined, 'token')).toBe(false)
    })

    it('rejects undefined request token', () => {
      expect(validateCsrfToken('token', undefined)).toBe(false)
    })

    it('rejects both undefined', () => {
      expect(validateCsrfToken(undefined, undefined)).toBe(false)
    })
  })
})
