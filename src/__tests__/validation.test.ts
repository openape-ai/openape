import { describe, expect, it } from 'vitest'
import { generateKeyPair, signJWT } from '../crypto/jwt.js'
import { validateAssertion } from '../validation/assertion.js'
import { computeCmdHash } from '../validation/grant.js'
import { validateClientMetadata } from '../validation/manifest.js'

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

  it('accepts assertion with missing act claim (OPTIONAL per spec)', async () => {
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

    expect(result.valid).toBe(true)
  })

  it('accepts assertion with free-form act claim string', async () => {
    const { publicKey, privateKey } = await generateKeyPair()
    const now = Math.floor(Date.now() / 1000)

    const token = await signJWT(
      { iss: 'https://idp.example.com', sub: 'alice@example.com', aud: 'sp.example.com', act: 'service', iat: now, exp: now + 300, nonce: 'n' },
      privateKey,
    )

    const result = await validateAssertion(token, {
      expectedIss: 'https://idp.example.com',
      expectedAud: 'sp.example.com',
      publicKey,
      now,
    })

    expect(result.valid).toBe(true)
    expect(result.claims?.act).toBe('service')
  })

  it('returns error when no key provided', async () => {
    const result = await validateAssertion('some.jwt.token', {
      expectedIss: 'iss',
      expectedAud: 'aud',
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('No verification key')
  })

  it('validates assertion with delegate claim', async () => {
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
        delegate: {
          sub: 'agent@idp.example.com',
          act: 'agent',
          grant_id: 'grant-123',
        },
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
    expect(result.claims?.delegate).toEqual({
      sub: 'agent@idp.example.com',
      act: 'agent',
      grant_id: 'grant-123',
    })
  })

  it('validates assertion with delegation act claim (rfc 8693)', async () => {
    const { publicKey, privateKey } = await generateKeyPair()
    const now = Math.floor(Date.now() / 1000)

    const token = await signJWT(
      {
        iss: 'https://idp.example.com',
        sub: 'patrick@hofmann.eco',
        aud: 'bank.example.com',
        act: { sub: 'agent+patrick@id.openape.at' },
        iat: now,
        exp: now + 300,
        nonce: 'n',
        delegation_grant: 'del-abc123',
      },
      privateKey,
    )

    const result = await validateAssertion(token, {
      expectedIss: 'https://idp.example.com',
      expectedAud: 'bank.example.com',
      publicKey,
      now,
    })

    expect(result.valid).toBe(true)
    expect(result.claims?.sub).toBe('patrick@hofmann.eco')
    expect(result.claims?.act).toEqual({ sub: 'agent+patrick@id.openape.at' })
    expect(result.claims?.delegation_grant).toBe('del-abc123')
  })
})

describe('validateClientMetadata', () => {
  it('validates correct client metadata', () => {
    const result = validateClientMetadata({
      client_id: 'sp.example.com',
      client_name: 'Example SP',
      redirect_uris: ['https://sp.example.com/callback'],
    })
    expect(result.valid).toBe(true)
    expect(result.manifest?.client_id).toBe('sp.example.com')
  })

  it('rejects metadata without client_id', () => {
    const result = validateClientMetadata({ client_name: 'Test', redirect_uris: ['https://example.com'] })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('client_id is required and must be a non-empty string')
  })

  it('rejects metadata without client_name', () => {
    const result = validateClientMetadata({ client_id: 'test', redirect_uris: ['https://example.com'] })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('client_name is required and must be a non-empty string')
  })

  it('rejects metadata with empty redirect_uris', () => {
    const result = validateClientMetadata({ client_id: 'test', client_name: 'Test', redirect_uris: [] })
    expect(result.valid).toBe(false)
  })

  it('rejects metadata with invalid redirect_uri', () => {
    const result = validateClientMetadata({ client_id: 'test', client_name: 'Test', redirect_uris: ['not-a-url'] })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('Invalid redirect_uri'))).toBe(true)
  })

  it('rejects non-object input', () => {
    const result = validateClientMetadata('string')
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
