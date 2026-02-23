import { describe, expect, it } from 'vitest'
import { generateKeyPair, signJWT } from '../crypto/jwt.js'
import { validateAssertion } from '../validation/assertion.js'
import { computeCmdHash } from '../validation/grant.js'
import { validateSPManifest } from '../validation/manifest.js'

describe('validateAssertion', () => {
  it('validates a correct assertion', async () => {
    const { publicKey, privateKey } = await generateKeyPair()
    const now = Math.floor(Date.now() / 1000)

    const token = await signJWT(
      {
        iss: 'https://idp.example.com',
        sub: 'alice@example.com',
        aud: 'sp.example.com',
        act: 'human',
        iat: now,
        exp: now + 300,
        nonce: 'test-nonce',
      },
      privateKey,
    )

    const result = await validateAssertion(token, {
      expectedIss: 'https://idp.example.com',
      expectedAud: 'sp.example.com',
      publicKey,
      expectedNonce: 'test-nonce',
      now,
    })

    expect(result.valid).toBe(true)
    expect(result.claims?.sub).toBe('alice@example.com')
    expect(result.claims?.act).toBe('human')
  })

  it('rejects assertion with wrong issuer', async () => {
    const { publicKey, privateKey } = await generateKeyPair()
    const now = Math.floor(Date.now() / 1000)

    const token = await signJWT(
      { iss: 'https://evil.com', sub: 'alice@example.com', aud: 'sp.example.com', act: 'human', iat: now, exp: now + 300, nonce: 'n' },
      privateKey,
    )

    const result = await validateAssertion(token, {
      expectedIss: 'https://idp.example.com',
      expectedAud: 'sp.example.com',
      publicKey,
    })

    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('rejects assertion with TTL > 300s', async () => {
    const { publicKey, privateKey } = await generateKeyPair()
    const now = Math.floor(Date.now() / 1000)

    const token = await signJWT(
      { iss: 'https://idp.example.com', sub: 'alice@example.com', aud: 'sp.example.com', act: 'human', iat: now, exp: now + 600, nonce: 'n' },
      privateKey,
    )

    const result = await validateAssertion(token, {
      expectedIss: 'https://idp.example.com',
      expectedAud: 'sp.example.com',
      publicKey,
      now,
    })

    expect(result.valid).toBe(false)
    expect(result.error).toContain('TTL')
  })

  it('rejects assertion with wrong nonce', async () => {
    const { publicKey, privateKey } = await generateKeyPair()
    const now = Math.floor(Date.now() / 1000)

    const token = await signJWT(
      { iss: 'https://idp.example.com', sub: 'alice@example.com', aud: 'sp.example.com', act: 'human', iat: now, exp: now + 300, nonce: 'wrong' },
      privateKey,
    )

    const result = await validateAssertion(token, {
      expectedIss: 'https://idp.example.com',
      expectedAud: 'sp.example.com',
      publicKey,
      expectedNonce: 'correct',
      now,
    })

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Nonce')
  })

  it('rejects assertion with missing act claim', async () => {
    const { publicKey, privateKey } = await generateKeyPair()
    const now = Math.floor(Date.now() / 1000)

    const token = await signJWT(
      { iss: 'https://idp.example.com', sub: 'alice@example.com', aud: 'sp.example.com', iat: now, exp: now + 300, nonce: 'n' },
      privateKey,
    )

    const result = await validateAssertion(token, {
      expectedIss: 'https://idp.example.com',
      expectedAud: 'sp.example.com',
      publicKey,
      now,
    })

    expect(result.valid).toBe(false)
    expect(result.error).toContain('act')
  })

  it('rejects assertion with invalid act claim', async () => {
    const { publicKey, privateKey } = await generateKeyPair()
    const now = Math.floor(Date.now() / 1000)

    const token = await signJWT(
      { iss: 'https://idp.example.com', sub: 'alice@example.com', aud: 'sp.example.com', act: 'bot', iat: now, exp: now + 300, nonce: 'n' },
      privateKey,
    )

    const result = await validateAssertion(token, {
      expectedIss: 'https://idp.example.com',
      expectedAud: 'sp.example.com',
      publicKey,
      now,
    })

    expect(result.valid).toBe(false)
    expect(result.error).toContain('act')
  })

  it('returns error when no key provided', async () => {
    const result = await validateAssertion('some.jwt.token', {
      expectedIss: 'iss',
      expectedAud: 'aud',
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('No verification key')
  })
})

describe('validateSPManifest', () => {
  it('validates a correct manifest', () => {
    const result = validateSPManifest({
      sp_id: 'sp.example.com',
      name: 'Example SP',
      redirect_uris: ['https://sp.example.com/callback'],
    })
    expect(result.valid).toBe(true)
    expect(result.manifest?.sp_id).toBe('sp.example.com')
  })

  it('rejects manifest without sp_id', () => {
    const result = validateSPManifest({ name: 'Test', redirect_uris: ['https://example.com'] })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('sp_id is required and must be a non-empty string')
  })

  it('rejects manifest with empty redirect_uris', () => {
    const result = validateSPManifest({ sp_id: 'test', name: 'Test', redirect_uris: [] })
    expect(result.valid).toBe(false)
  })

  it('rejects manifest with invalid redirect_uri', () => {
    const result = validateSPManifest({ sp_id: 'test', name: 'Test', redirect_uris: ['not-a-url'] })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('Invalid redirect_uri'))).toBe(true)
  })

  it('rejects non-object input', () => {
    const result = validateSPManifest('string')
    expect(result.valid).toBe(false)
  })
})

describe('computeCmdHash', () => {
  it('computes a SHA-256 hex hash', async () => {
    const hash = await computeCmdHash('sudo rm -rf /')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces deterministic hashes', async () => {
    const h1 = await computeCmdHash('test')
    const h2 = await computeCmdHash('test')
    expect(h1).toBe(h2)
  })

  it('produces different hashes for different commands', async () => {
    const h1 = await computeCmdHash('command1')
    const h2 = await computeCmdHash('command2')
    expect(h1).not.toBe(h2)
  })
})
