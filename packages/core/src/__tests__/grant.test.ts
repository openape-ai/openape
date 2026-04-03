import { describe, expect, it } from 'vitest'
import { generateKeyPair, signJWT } from '../crypto/jwt.js'
import { validateAuthzJWT } from '../validation/grant.js'

describe('validateAuthzJWT', () => {
  it('validates a correct AuthZ JWT', async () => {
    const { publicKey, privateKey } = await generateKeyPair()
    const now = Math.floor(Date.now() / 1000)

    const token = await signJWT(
      {
        iss: 'https://openape.example.com',
        sub: 'agent@example.com',
        aud: 'sp.example.com',
        target_host: 'sp.example.com',
        iat: now,
        exp: now + 300,
        jti: 'jwt-id-123',
        grant_id: 'grant-123',
        grant_type: 'once',
        permissions: ['doc:read', 'doc:write'],
      },
      privateKey,
    )

    const result = await validateAuthzJWT(token, {
      expectedIss: 'https://openape.example.com',
      expectedAud: 'sp.example.com',
      publicKey,
    })

    expect(result.valid).toBe(true)
    expect(result.claims?.sub).toBe('agent@example.com')
    expect(result.claims?.grant_id).toBe('grant-123')
    expect(result.claims?.permissions).toEqual(['doc:read', 'doc:write'])
  })

  it('returns error when no key or JWKS URI provided', async () => {
    const result = await validateAuthzJWT('some.jwt.token', {
      expectedIss: 'iss',
      expectedAud: 'aud',
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('No verification key or JWKS URI provided')
  })

  it('returns error for missing required permission', async () => {
    const { publicKey, privateKey } = await generateKeyPair()
    const now = Math.floor(Date.now() / 1000)

    const token = await signJWT(
      {
        iss: 'https://openape.example.com',
        sub: 'agent@example.com',
        aud: 'sp.example.com',
        iat: now,
        exp: now + 300,
        jti: 'jwt-id-123',
        grant_id: 'grant-123',
        grant_type: 'once',
        permissions: ['doc:read'],
      },
      privateKey,
    )

    const result = await validateAuthzJWT(token, {
      expectedIss: 'https://openape.example.com',
      expectedAud: 'sp.example.com',
      publicKey,
      requiredPermission: 'doc:delete',
    })

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Missing required permission: doc:delete')
  })

  it('returns error for command hash mismatch', async () => {
    const { publicKey, privateKey } = await generateKeyPair()
    const now = Math.floor(Date.now() / 1000)

    const token = await signJWT(
      {
        iss: 'https://openape.example.com',
        sub: 'agent@example.com',
        aud: 'sp.example.com',
        iat: now,
        exp: now + 300,
        jti: 'jwt-id-123',
        grant_id: 'grant-123',
        grant_type: 'once',
        cmd_hash: 'abc123',
      },
      privateKey,
    )

    const result = await validateAuthzJWT(token, {
      expectedIss: 'https://openape.example.com',
      expectedAud: 'sp.example.com',
      publicKey,
      expectedCmdHash: 'xyz789',
    })

    expect(result.valid).toBe(false)
    expect(result.error).toBe('Command hash mismatch')
  })

  it('catches verification errors (wrong issuer)', async () => {
    const { publicKey, privateKey } = await generateKeyPair()
    const now = Math.floor(Date.now() / 1000)

    const token = await signJWT(
      {
        iss: 'https://evil.com',
        sub: 'agent@example.com',
        aud: 'sp.example.com',
        iat: now,
        exp: now + 300,
        jti: 'jwt-id-123',
        grant_id: 'grant-123',
        grant_type: 'once',
      },
      privateKey,
    )

    const result = await validateAuthzJWT(token, {
      expectedIss: 'https://openape.example.com',
      expectedAud: 'sp.example.com',
      publicKey,
    })

    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('passes when required permission is present', async () => {
    const { publicKey, privateKey } = await generateKeyPair()
    const now = Math.floor(Date.now() / 1000)

    const token = await signJWT(
      {
        iss: 'https://openape.example.com',
        sub: 'agent@example.com',
        aud: 'sp.example.com',
        iat: now,
        exp: now + 300,
        jti: 'jwt-id-123',
        grant_id: 'grant-123',
        grant_type: 'once',
        permissions: ['doc:read', 'doc:delete'],
      },
      privateKey,
    )

    const result = await validateAuthzJWT(token, {
      expectedIss: 'https://openape.example.com',
      expectedAud: 'sp.example.com',
      publicKey,
      requiredPermission: 'doc:delete',
    })

    expect(result.valid).toBe(true)
  })

  it('passes when command hash matches', async () => {
    const { publicKey, privateKey } = await generateKeyPair()
    const now = Math.floor(Date.now() / 1000)

    const token = await signJWT(
      {
        iss: 'https://openape.example.com',
        sub: 'agent@example.com',
        aud: 'sp.example.com',
        iat: now,
        exp: now + 300,
        jti: 'jwt-id-123',
        grant_id: 'grant-123',
        grant_type: 'once',
        cmd_hash: 'abc123',
      },
      privateKey,
    )

    const result = await validateAuthzJWT(token, {
      expectedIss: 'https://openape.example.com',
      expectedAud: 'sp.example.com',
      publicKey,
      expectedCmdHash: 'abc123',
    })

    expect(result.valid).toBe(true)
  })

  it('catches non-Error thrown values', async () => {
    // Testing the catch path with non-Error — verifyJWT will throw
    // when given a malformed token
    const { publicKey } = await generateKeyPair()

    const result = await validateAuthzJWT('not.a.valid-jwt', {
      expectedIss: 'iss',
      expectedAud: 'aud',
      publicKey,
    })

    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })
})
