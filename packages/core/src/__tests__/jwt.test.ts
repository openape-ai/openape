import { describe, expect, it } from 'vitest'
import { exportPublicKeyJWK, generateKeyPair, importJWK, signJWT, verifyJWT } from '../crypto/jwt.js'

describe('JWT sign and verify', () => {
  it('signs and verifies a JWT with EdDSA', async () => {
    const { publicKey, privateKey } = await generateKeyPair()

    const token = await signJWT(
      { iss: 'https://idp.example.com', sub: 'alice@example.com', aud: 'sp.example.com', nonce: 'test-nonce' },
      privateKey,
      { kid: 'key-1' },
    )
    expect(token.split('.')).toHaveLength(3)

    const { payload, protectedHeader } = await verifyJWT(token, publicKey, {
      issuer: 'https://idp.example.com',
      audience: 'sp.example.com',
    })

    expect(payload.sub).toBe('alice@example.com')
    expect(payload.nonce).toBe('test-nonce')
    expect(protectedHeader.kid).toBe('key-1')
    expect(protectedHeader.alg).toBe('EdDSA')
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
    await expect(verifyJWT(token, publicKey, { issuer: 'expected' })).rejects.toThrow()
  })

  it('verifies JWT with a GetKeyFunction', async () => {
    const { publicKey, privateKey } = await generateKeyPair()
    const token = await signJWT({ iss: 'test', sub: 'test', aud: 'test' }, privateKey)
    const { payload } = await verifyJWT(token, async () => publicKey)
    expect(payload.sub).toBe('test')
  })

  it('exports and re-imports a public key via JWK', async () => {
    const { publicKey, privateKey } = await generateKeyPair()

    const jwk = await exportPublicKeyJWK(publicKey, 'round-trip')
    expect(jwk).toMatchObject({ alg: 'EdDSA', use: 'sig', kid: 'round-trip', kty: 'OKP' })

    const jwkNoKid = await exportPublicKeyJWK(publicKey)
    expect(jwkNoKid.kid).toBeUndefined()

    const imported = await importJWK(jwk)
    const token = await signJWT({ iss: 'test', sub: 'test', aud: 'test' }, privateKey)
    const { payload } = await verifyJWT(token, imported)
    expect(payload.sub).toBe('test')
  })
})
