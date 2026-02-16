import { describe, it, expect } from 'vitest'
import { generateKeyPair, signJWT, verifyJWT, exportPublicKeyJWK } from '../crypto/jwt.js'

describe('JWT sign and verify', () => {
  it('signs and verifies a JWT with ES256', async () => {
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

  it('exports public key as JWK', async () => {
    const { publicKey } = await generateKeyPair()
    const jwk = await exportPublicKeyJWK(publicKey, 'key-1')
    expect(jwk.alg).toBe('ES256')
    expect(jwk.use).toBe('sig')
    expect(jwk.kid).toBe('key-1')
    expect(jwk.kty).toBe('EC')
  })
})
