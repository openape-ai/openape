import { describe, expect, it } from 'vitest'
import { generateKeyPair, signJWT } from '../crypto/jwt.js'
import { validateAuthzJWT } from '../validation/grant.js'

describe('validateAuthzJWT', () => {
  async function makeToken(claims: Record<string, unknown>) {
    const { publicKey, privateKey } = await generateKeyPair()
    const now = Math.floor(Date.now() / 1000)
    const token = await signJWT(
      { iss: 'https://openape.example.com', sub: 'agent@example.com', aud: 'sp.example.com', iat: now, exp: now + 300, jti: 'jwt-1', grant_id: 'g-1', grant_type: 'once', ...claims },
      privateKey,
    )
    return { token, publicKey }
  }

  it('validates a correct AuthZ JWT with permissions and cmd_hash', async () => {
    const { token, publicKey } = await makeToken({ permissions: ['doc:read'], cmd_hash: 'abc' })
    const result = await validateAuthzJWT(token, {
      expectedIss: 'https://openape.example.com',
      expectedAud: 'sp.example.com',
      publicKey,
      requiredPermission: 'doc:read',
      expectedCmdHash: 'abc',
    })
    expect(result.valid).toBe(true)
    expect(result.claims?.permissions).toEqual(['doc:read'])
  })

  it('returns error when no key or JWKS URI provided', async () => {
    const result = await validateAuthzJWT('x.y.z', { expectedIss: 'iss', expectedAud: 'aud' })
    expect(result).toMatchObject({ valid: false, error: 'No verification key or JWKS URI provided' })
  })

  it('returns error for missing required permission', async () => {
    const { token, publicKey } = await makeToken({ permissions: ['doc:read'] })
    const result = await validateAuthzJWT(token, {
      expectedIss: 'https://openape.example.com', expectedAud: 'sp.example.com', publicKey, requiredPermission: 'doc:delete',
    })
    expect(result).toMatchObject({ valid: false, error: 'Missing required permission: doc:delete' })
  })

  it('returns error for command hash mismatch', async () => {
    const { token, publicKey } = await makeToken({ cmd_hash: 'abc' })
    const result = await validateAuthzJWT(token, {
      expectedIss: 'https://openape.example.com', expectedAud: 'sp.example.com', publicKey, expectedCmdHash: 'xyz',
    })
    expect(result).toMatchObject({ valid: false, error: 'Command hash mismatch' })
  })

  it('catches verification errors (wrong issuer, malformed token)', async () => {
    const { publicKey } = await generateKeyPair()
    const result = await validateAuthzJWT('not.a.jwt', {
      expectedIss: 'iss', expectedAud: 'aud', publicKey,
    })
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })
})
