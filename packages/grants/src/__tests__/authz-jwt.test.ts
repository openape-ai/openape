import type { OpenApeGrant } from '@openape/core'
import { generateKeyPair } from '@openape/core'
import { describe, expect, it } from 'vitest'
import { issueAuthzJWT, verifyAuthzJWT } from '../authz-jwt.js'

function makeApprovedGrant(overrides?: Partial<OpenApeGrant>): OpenApeGrant {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: 'grant-123',
    request: {
      requester: 'agent@example.com',
      target_host: 'macmini',
      audience: 'apes',
      grant_type: 'once',
      permissions: ['read', 'write'],
    },
    status: 'approved',
    decided_by: 'admin@example.com',
    created_at: now - 60,
    decided_at: now,
    ...overrides,
  }
}

describe('authZ-JWT', () => {
  describe('issueAuthzJWT', () => {
    it('issues a JWT for an approved once-grant', async () => {
      const { privateKey } = await generateKeyPair()
      const grant = makeApprovedGrant()

      const token = await issueAuthzJWT(grant, 'https://openape.example.com', privateKey)

      expect(typeof token).toBe('string')
      expect(token.split('.')).toHaveLength(3)
    })

    it('issues a JWT for an approved timed-grant', async () => {
      const { privateKey } = await generateKeyPair()
      const now = Math.floor(Date.now() / 1000)
      const grant = makeApprovedGrant({
        request: {
          requester: 'agent@example.com',
          target_host: 'macmini',
          audience: 'apes',
          grant_type: 'timed',
          permissions: ['read'],
          duration: 3600,
        },
        expires_at: now + 3600,
      })

      const token = await issueAuthzJWT(grant, 'https://openape.example.com', privateKey)
      expect(typeof token).toBe('string')
    })

    it('issues a JWT for an approved always-grant', async () => {
      const { privateKey } = await generateKeyPair()
      const grant = makeApprovedGrant({
        request: {
          requester: 'agent@example.com',
          target_host: 'macmini',
          audience: 'apes',
          grant_type: 'always',
          permissions: ['read'],
        },
      })

      const token = await issueAuthzJWT(grant, 'https://openape.example.com', privateKey)
      expect(typeof token).toBe('string')
    })

    it('rejects non-approved grants', async () => {
      const { privateKey } = await generateKeyPair()
      const grant = makeApprovedGrant({ status: 'pending' })

      await expect(
        issueAuthzJWT(grant, 'https://openape.example.com', privateKey),
      ).rejects.toThrow('Grant is not approved')
    })

    it('rejects timed grant without expires_at', async () => {
      const { privateKey } = await generateKeyPair()
      const grant = makeApprovedGrant({
        request: {
          requester: 'agent@example.com',
          target_host: 'macmini',
          audience: 'apes',
          grant_type: 'timed',
          duration: 3600,
        },
        // no expires_at
      })

      await expect(
        issueAuthzJWT(grant, 'https://openape.example.com', privateKey),
      ).rejects.toThrow('Timed grant missing expires_at')
    })

    it('includes kid in JWT header when provided', async () => {
      const { privateKey, publicKey } = await generateKeyPair()
      const grant = makeApprovedGrant()

      const token = await issueAuthzJWT(
        grant,
        'https://openape.example.com',
        privateKey,
        'my-key-1',
      )

      const result = await verifyAuthzJWT(token, { publicKey })
      expect(result.valid).toBe(true)
    })
  })

  describe('verifyAuthzJWT', () => {
    it('verifies a valid JWT round-trip', async () => {
      const { publicKey, privateKey } = await generateKeyPair()
      const grant = makeApprovedGrant()

      const token = await issueAuthzJWT(grant, 'https://openape.example.com', privateKey)
      const result = await verifyAuthzJWT(token, {
        publicKey,
        expectedIss: 'https://openape.example.com',
        expectedAud: 'apes',
      })

      expect(result.valid).toBe(true)
      expect(result.claims).toBeDefined()
      expect(result.claims!.iss).toBe('https://openape.example.com')
      expect(result.claims!.sub).toBe('agent@example.com')
      expect(result.claims!.aud).toBe('apes')
      expect(result.claims!.target_host).toBe('macmini')
      expect(result.claims!.grant_id).toBe('grant-123')
      expect(result.claims!.grant_type).toBe('once')
      expect(result.claims!.permissions).toEqual(['read', 'write'])
    })

    it('rejects JWT with wrong key', async () => {
      const { privateKey } = await generateKeyPair()
      const { publicKey: wrongKey } = await generateKeyPair()
      const grant = makeApprovedGrant()

      const token = await issueAuthzJWT(grant, 'https://openape.example.com', privateKey)
      const result = await verifyAuthzJWT(token, { publicKey: wrongKey })

      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('rejects JWT with wrong issuer', async () => {
      const { publicKey, privateKey } = await generateKeyPair()
      const grant = makeApprovedGrant()

      const token = await issueAuthzJWT(grant, 'https://openape.example.com', privateKey)
      const result = await verifyAuthzJWT(token, {
        publicKey,
        expectedIss: 'https://wrong-issuer.example.com',
      })

      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('rejects JWT with wrong audience', async () => {
      const { publicKey, privateKey } = await generateKeyPair()
      const grant = makeApprovedGrant()

      const token = await issueAuthzJWT(grant, 'https://openape.example.com', privateKey)
      const result = await verifyAuthzJWT(token, {
        publicKey,
        expectedAud: 'wrong-audience',
      })

      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('returns error when no key or JWKS URI provided', async () => {
      const { privateKey } = await generateKeyPair()
      const grant = makeApprovedGrant()

      const token = await issueAuthzJWT(grant, 'https://openape.example.com', privateKey)
      const result = await verifyAuthzJWT(token, {})

      expect(result.valid).toBe(false)
      expect(result.error).toBe('No verification key or JWKS URI provided')
    })

    it('includes decided_by in claims when set on grant', async () => {
      const { publicKey, privateKey } = await generateKeyPair()
      const grant = makeApprovedGrant({ decided_by: 'admin@example.com' })

      const token = await issueAuthzJWT(grant, 'https://openape.example.com', privateKey)
      const result = await verifyAuthzJWT(token, { publicKey })

      expect(result.valid).toBe(true)
      expect(result.claims!.decided_by).toBe('admin@example.com')
    })

    it('omits decided_by when not set on grant', async () => {
      const { publicKey, privateKey } = await generateKeyPair()
      const grant = makeApprovedGrant({ decided_by: undefined })

      const token = await issueAuthzJWT(grant, 'https://openape.example.com', privateKey)
      const result = await verifyAuthzJWT(token, { publicKey })

      expect(result.valid).toBe(true)
      expect(result.claims!.decided_by).toBeUndefined()
    })

    it('includes cmd_hash in claims when present', async () => {
      const { publicKey, privateKey } = await generateKeyPair()
      const grant = makeApprovedGrant({
        request: {
          requester: 'agent@example.com',
          target_host: 'macmini',
          audience: 'apes',
          grant_type: 'once',
          cmd_hash: 'abc123hash',
        },
      })

      const token = await issueAuthzJWT(grant, 'https://openape.example.com', privateKey)
      const result = await verifyAuthzJWT(token, { publicKey })

      expect(result.valid).toBe(true)
      expect(result.claims!.cmd_hash).toBe('abc123hash')
    })
  })
})
