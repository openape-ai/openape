import { describe, expect, it } from 'vitest'
import { generateJWKS, serveJWKS } from '../idp/jwks.js'
import { InMemoryKeyStore } from '../idp/stores.js'

describe('generateJWKS', () => {
  it('returns public keys from the key store', async () => {
    const keyStore = new InMemoryKeyStore()
    const jwks = await generateJWKS(keyStore)

    expect(jwks.keys).toHaveLength(1)
    expect(jwks.keys[0].kid).toBe('key-1')
    expect(jwks.keys[0].kty).toBe('OKP')
    expect(jwks.keys[0].crv).toBe('Ed25519')
    // Public key should not contain private key material
    expect(jwks.keys[0].d).toBeUndefined()
  })
})

describe('serveJWKS', () => {
  it('returns a JSON Response with correct headers', async () => {
    const keyStore = new InMemoryKeyStore()
    const response = await serveJWKS(keyStore)

    expect(response).toBeInstanceOf(Response)
    expect(response.headers.get('Content-Type')).toBe('application/json')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600')

    const body = await response.json()
    expect(body.keys).toHaveLength(1)
    expect(body.keys[0].kid).toBe('key-1')
  })
})
