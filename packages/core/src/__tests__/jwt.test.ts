import { describe, expect, it } from 'vitest'
import { createRemoteJWKS, exportPublicKeyJWK, generateKeyPair, importJWK, signJWT, verifyJWT } from '../crypto/jwt.js'

describe('jWT sign and verify', () => {
  it('signs and verifies a JWT with EdDSA', async () => {
    const { publicKey, privateKey } = await generateKeyPair()

    const payload = {
      iss: 'https://idp.example.com',
      sub: 'alice@example.com',
      aud: 'sp.example.com',
      nonce: 'test-nonce',
    }

    const token = await signJWT(payload, privateKey)
    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3)

    const { payload: verified } = await verifyJWT(token, publicKey, {
      issuer: 'https://idp.example.com',
      audience: 'sp.example.com',
    })

    expect(verified.iss).toBe('https://idp.example.com')
    expect(verified.sub).toBe('alice@example.com')
    expect(verified.aud).toBe('sp.example.com')
    expect(verified.nonce).toBe('test-nonce')
  })

  it('signs JWT without kid option', async () => {
    const { publicKey, privateKey } = await generateKeyPair()

    const token = await signJWT({ iss: 'test', sub: 'test', aud: 'test' }, privateKey)
    expect(typeof token).toBe('string')

    // Verify it can be decoded — header should not contain kid
    const { protectedHeader } = await verifyJWT(token, publicKey)
    expect(protectedHeader.alg).toBe('EdDSA')
    expect(protectedHeader.kid).toBeUndefined()
  })

  it('signs JWT with kid option', async () => {
    const { publicKey, privateKey } = await generateKeyPair()

    const token = await signJWT({ iss: 'test', sub: 'test', aud: 'test' }, privateKey, { kid: 'my-key-1' })
    const { protectedHeader } = await verifyJWT(token, publicKey)
    expect(protectedHeader.kid).toBe('my-key-1')
  })

  it('rejects JWT with wrong key', async () => {
    const { privateKey } = await generateKeyPair()
    const { publicKey: wrongKey } = await generateKeyPair()

    const token = await signJWT({ iss: 'test', sub: 'test', aud: 'test' }, privateKey)

    await expect(verifyJWT(token, wrongKey)).rejects.toThrow()
  })

  it('rejects JWT with wrong issuer', async () => {
    const { publicKey, privateKey } = await generateKeyPair()
    const token = await signJWT({ iss: 'wrong', sub: 'test', aud: 'test' }, privateKey)

    await expect(
      verifyJWT(token, publicKey, { issuer: 'expected' }),
    ).rejects.toThrow()
  })

  it('verifies JWT with a GetKeyFunction', async () => {
    const { publicKey, privateKey } = await generateKeyPair()

    const token = await signJWT({ iss: 'test', sub: 'test', aud: 'test' }, privateKey)

    // Create a simple GetKeyFunction that always returns the same key
    const getKey = async () => publicKey

    const { payload } = await verifyJWT(token, getKey)
    expect(payload.iss).toBe('test')
    expect(payload.sub).toBe('test')
  })

  it('exports public key as JWK', async () => {
    const { publicKey } = await generateKeyPair()
    const jwk = await exportPublicKeyJWK(publicKey, 'key-1')
    expect(jwk.alg).toBe('EdDSA')
    expect(jwk.use).toBe('sig')
    expect(jwk.kid).toBe('key-1')
    expect(jwk.kty).toBe('OKP')
  })

  it('exports public key as JWK without kid', async () => {
    const { publicKey } = await generateKeyPair()
    const jwk = await exportPublicKeyJWK(publicKey)
    expect(jwk.alg).toBe('EdDSA')
    expect(jwk.use).toBe('sig')
    expect(jwk.kid).toBeUndefined()
    expect(jwk.kty).toBe('OKP')
  })

  it('imports a JWK and uses it for verification', async () => {
    const { publicKey, privateKey } = await generateKeyPair()

    // Export and re-import
    const jwk = await exportPublicKeyJWK(publicKey, 'round-trip')
    const imported = await importJWK(jwk)

    // Sign with original key, verify with imported key
    const token = await signJWT({ iss: 'test', sub: 'test', aud: 'test' }, privateKey)
    const { payload } = await verifyJWT(token, imported)
    expect(payload.sub).toBe('test')
  })

  it('creates a remote JWKS function', () => {
    const getKey = createRemoteJWKS('https://idp.example.com/.well-known/jwks.json')
    expect(typeof getKey).toBe('function')
  })
})
