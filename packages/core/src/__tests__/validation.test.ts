import { describe, expect, it } from 'vitest'
import { generateKeyPair, signJWT } from '../crypto/jwt.js'
import { validateAssertion } from '../validation/assertion.js'
import { computeCmdHash } from '../validation/grant.js'

describe('validateAssertion', () => {
  async function makeAssertion(claims: Record<string, unknown>) {
    const kp = await generateKeyPair()
    const now = Math.floor(Date.now() / 1000)
    const token = await signJWT(
      { iss: 'https://idp.example.com', sub: 'alice@example.com', aud: 'sp.example.com', act: 'human', iat: now, exp: now + 300, nonce: 'n', ...claims },
      kp.privateKey,
    )
    return { token, publicKey: kp.publicKey }
  }

  it('validates a correct assertion', async () => {
    const { token, publicKey } = await makeAssertion({ nonce: 'test-nonce' })
    const result = await validateAssertion(token, {
      expectedIss: 'https://idp.example.com', expectedAud: 'sp.example.com', publicKey, expectedNonce: 'test-nonce',
    })
    expect(result.valid).toBe(true)
    expect(result.claims?.sub).toBe('alice@example.com')
    expect(result.claims?.act).toBe('human')
  })

  it('rejects assertion with wrong issuer', async () => {
    const { token, publicKey } = await makeAssertion({ iss: 'https://evil.com' })
    const result = await validateAssertion(token, { expectedIss: 'https://idp.example.com', expectedAud: 'sp.example.com', publicKey })
    expect(result.valid).toBe(false)
  })

  it('rejects assertion with TTL > 300s', async () => {
    const now = Math.floor(Date.now() / 1000)
    const { token, publicKey } = await makeAssertion({ iat: now, exp: now + 600 })
    const result = await validateAssertion(token, { expectedIss: 'https://idp.example.com', expectedAud: 'sp.example.com', publicKey })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('TTL')
  })

  it('rejects assertion with wrong nonce', async () => {
    const { token, publicKey } = await makeAssertion({ nonce: 'wrong' })
    const result = await validateAssertion(token, { expectedIss: 'https://idp.example.com', expectedAud: 'sp.example.com', publicKey, expectedNonce: 'correct' })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Nonce')
  })

  it('returns error when no key provided', async () => {
    const result = await validateAssertion('some.jwt.token', { expectedIss: 'iss', expectedAud: 'aud' })
    expect(result).toMatchObject({ valid: false, error: 'No verification key or JWKS URI provided' })
  })

  it('accepts RFC 8693 delegation act claim ({ sub: string })', async () => {
    const { token, publicKey } = await makeAssertion({ act: { sub: 'agent@example.com' } })
    const result = await validateAssertion(token, { expectedIss: 'https://idp.example.com', expectedAud: 'sp.example.com', publicKey })
    expect(result.valid).toBe(true)
    expect(result.claims?.act).toEqual({ sub: 'agent@example.com' })
  })

  it('rejects invalid act claim types', async () => {
    const { token: t1, publicKey: k1 } = await makeAssertion({ act: 42 })
    expect((await validateAssertion(t1, { expectedIss: 'https://idp.example.com', expectedAud: 'sp.example.com', publicKey: k1 })).error).toContain('Invalid act')

    const { token: t2, publicKey: k2 } = await makeAssertion({ act: { role: 'admin' } })
    expect((await validateAssertion(t2, { expectedIss: 'https://idp.example.com', expectedAud: 'sp.example.com', publicKey: k2 })).error).toContain('Invalid delegation act')
  })

  it('rejects assertion with missing sub claim', async () => {
    const kp = await generateKeyPair()
    const now = Math.floor(Date.now() / 1000)
    const token = await signJWT(
      { iss: 'https://idp.example.com', aud: 'sp.example.com', iat: now, exp: now + 300 },
      kp.privateKey,
    )
    const result = await validateAssertion(token, { expectedIss: 'https://idp.example.com', expectedAud: 'sp.example.com', publicKey: kp.publicKey })
    expect(result).toMatchObject({ valid: false, error: 'Missing sub claim' })
  })
})

describe('computeCmdHash', () => {
  it('produces deterministic SHA-256 hex hashes', async () => {
    const h1 = await computeCmdHash('test')
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    expect(await computeCmdHash('test')).toBe(h1)
    expect(await computeCmdHash('other')).not.toBe(h1)
  })
})
