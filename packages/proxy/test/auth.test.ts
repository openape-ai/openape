import { describe, expect, it } from 'vitest'
import { AuthError, verifyAgentAuth } from '../src/auth.js'

describe('verifyAgentAuth', () => {
  const idpUrl = 'https://id.example.com'

  describe('non-mandatory mode', () => {
    it('returns null when no header provided', async () => {
      const result = await verifyAgentAuth(null, idpUrl, false)
      expect(result).toBeNull()
    })

    it('returns null for invalid header format', async () => {
      const result = await verifyAgentAuth('Basic abc123', idpUrl, false)
      expect(result).toBeNull()
    })

    it('returns null for invalid JWT', async () => {
      const result = await verifyAgentAuth('Bearer invalid.token.here', idpUrl, false)
      expect(result).toBeNull()
    })
  })

  describe('mandatory mode', () => {
    it('throws AuthError when no header provided', async () => {
      await expect(
        verifyAgentAuth(null, idpUrl, true),
      ).rejects.toThrow(AuthError)
    })

    it('throws AuthError with "JWT required" message', async () => {
      await expect(
        verifyAgentAuth(null, idpUrl, true),
      ).rejects.toThrow('JWT required')
    })

    it('throws AuthError for invalid header format', async () => {
      await expect(
        verifyAgentAuth('Basic abc123', idpUrl, true),
      ).rejects.toThrow(AuthError)
    })

    it('throws AuthError for invalid JWT token', async () => {
      await expect(
        verifyAgentAuth('Bearer invalid.token.here', idpUrl, true),
      ).rejects.toThrow(AuthError)
    })
  })

  describe('authError', () => {
    it('is an instance of Error', () => {
      const err = new AuthError('test')
      expect(err).toBeInstanceOf(Error)
      expect(err.name).toBe('AuthError')
    })
  })
})
