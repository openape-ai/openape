import { describe, expect, it } from 'vitest'
import type { ResolvedConfig } from '../config.js'
import { get } from '../helpers.js'

export function discoveryTests(config: ResolvedConfig) {
  describe('OIDC Discovery', () => {
    it('returns valid openid-configuration', async () => {
      const { status, data } = await get(config.baseUrl, '/.well-known/openid-configuration')
      expect(status).toBe(200)
      expect(data.issuer).toBeTruthy()
      expect(data.authorization_endpoint).toBeTruthy()
      expect(data.token_endpoint).toBeTruthy()
      expect(data.jwks_uri).toBeTruthy()
      expect(data.ddisa_version).toBeTruthy()
    })

    it('discovery contains grant_types_supported', async () => {
      const { data } = await get(config.baseUrl, '/.well-known/openid-configuration')
      expect(data.grant_types_supported).toBeDefined()
      expect(Array.isArray(data.grant_types_supported)).toBe(true)
      expect(data.grant_types_supported).toContain('authorization_code')
    })

    it('returns valid JWKS', async () => {
      const { status, data } = await get(config.baseUrl, '/.well-known/jwks.json')
      expect(status).toBe(200)
      expect(data.keys).toBeDefined()
      expect(Array.isArray(data.keys)).toBe(true)
      expect(data.keys.length).toBeGreaterThan(0)
    })

    it('JWKS keys have required fields', async () => {
      const { data } = await get(config.baseUrl, '/.well-known/jwks.json')
      for (const key of data.keys) {
        expect(key.alg).toBe('EdDSA')
        expect(key.use).toBe('sig')
        expect(key.kid).toBeDefined()
      }
    })
  })
}
