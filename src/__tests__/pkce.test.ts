import { describe, it, expect } from 'vitest'
import { generateCodeVerifier, generateCodeChallenge, generateState, generateNonce } from '../crypto/pkce.js'

describe('PKCE', () => {
  it('generates a code verifier of expected length', () => {
    const verifier = generateCodeVerifier()
    expect(verifier).toBeTruthy()
    expect(typeof verifier).toBe('string')
    // Base64url of 64 bytes → ~86 chars
    expect(verifier.length).toBeGreaterThan(40)
  })

  it('generates unique verifiers', () => {
    const v1 = generateCodeVerifier()
    const v2 = generateCodeVerifier()
    expect(v1).not.toBe(v2)
  })

  it('generates a valid S256 code challenge', async () => {
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)
    expect(challenge).toBeTruthy()
    expect(typeof challenge).toBe('string')
    // Base64url of SHA-256 (32 bytes) → 43 chars
    expect(challenge.length).toBe(43)
  })

  it('generates deterministic challenge for same verifier', async () => {
    const verifier = 'test-verifier-123'
    const c1 = await generateCodeChallenge(verifier)
    const c2 = await generateCodeChallenge(verifier)
    expect(c1).toBe(c2)
  })
})

describe('state and nonce', () => {
  it('generates unique state values', () => {
    const s1 = generateState()
    const s2 = generateState()
    expect(s1).not.toBe(s2)
  })

  it('generates unique nonce values', () => {
    const n1 = generateNonce()
    const n2 = generateNonce()
    expect(n1).not.toBe(n2)
  })
})
