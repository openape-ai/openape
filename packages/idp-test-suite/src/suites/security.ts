import { describe, expect, it } from 'vitest'
import type { ResolvedConfig } from '../config.js'
import { get, post } from '../helpers.js'

export function securityTests(config: ResolvedConfig) {
  describe('Security Headers & Caching', () => {
    it('security headers present on API responses', async () => {
      const { headers } = await post(config.baseUrl, '/api/auth/challenge', { id: 'nonexistent@example.com' })
      expect(headers.get('x-content-type-options')).toBe('nosniff')
      expect(headers.get('x-frame-options')).toBe('DENY')
      expect(headers.get('content-security-policy')).toBe('frame-ancestors \'none\'')
      expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    })

    it('security headers present on error responses', async () => {
      const { headers, status } = await post(config.baseUrl, '/api/auth/challenge', {})
      expect(status).toBe(400)
      expect(headers.get('x-content-type-options')).toBe('nosniff')
      expect(headers.get('x-frame-options')).toBe('DENY')
    })

    it('Cache-Control: no-store on auth endpoints', async () => {
      const { headers } = await post(config.baseUrl, '/api/auth/challenge', { id: 'nonexistent@example.com' })
      expect(headers.get('cache-control')).toBe('no-store')
    })

    it('Cache-Control: public on JWKS', async () => {
      const { headers } = await get(config.baseUrl, '/.well-known/jwks.json')
      const cc = headers.get('cache-control')
      expect(cc).toBeTruthy()
      expect(cc).toContain('public')
    })

    it('Cache-Control: public on Discovery', async () => {
      const { headers } = await get(config.baseUrl, '/.well-known/openid-configuration')
      const cc = headers.get('cache-control')
      expect(cc).toBeTruthy()
      expect(cc).toContain('public')
    })

    it('no CORS on admin endpoints', async () => {
      const { headers } = await get(
        config.baseUrl,
        '/api/admin/users',
        config.managementToken,
      )
      expect(headers.get('access-control-allow-origin')).toBeNull()
    })

    it('CORS present on API auth endpoints', async () => {
      const { headers } = await post(config.baseUrl, '/api/auth/challenge', { id: 'x@example.com' })
      expect(headers.get('access-control-allow-origin')).toBe('*')
    })

    it('CORS present on JWKS', async () => {
      const { headers } = await get(config.baseUrl, '/.well-known/jwks.json')
      expect(headers.get('access-control-allow-origin')).toBe('*')
    })

    it('CORS present on Discovery', async () => {
      const { headers } = await get(config.baseUrl, '/.well-known/openid-configuration')
      expect(headers.get('access-control-allow-origin')).toBe('*')
    })

    it('CORS present on token endpoint', async () => {
      const { headers } = await post(config.baseUrl, '/token', {
        grant_type: 'authorization_code',
        code: 'fake',
      })
      expect(headers.get('access-control-allow-origin')).toBe('*')
    })

    it('CORS present on grants endpoint', async () => {
      const { headers } = await post(config.baseUrl, '/api/grants', {}, 'fake-token')
      expect(headers.get('access-control-allow-origin')).toBe('*')
    })

    it('CORS present on delegations endpoint', async () => {
      const { headers } = await post(
        config.baseUrl,
        '/api/delegations',
        {},
        'fake-token',
      )
      expect(headers.get('access-control-allow-origin')).toBe('*')
    })

    it('no CORS on session endpoints', async () => {
      const { headers } = await post(config.baseUrl, '/api/session/login', {
        email: 'x',
        password: 'y',
      })
      expect(headers.get('access-control-allow-origin')).toBeNull()
    })

    it('no CORS on authorize endpoint', async () => {
      const res = await fetch(`${config.baseUrl}/authorize?client_id=x&redirect_uri=x&response_type=code`, {
        redirect: 'manual',
      })
      expect(res.headers.get('access-control-allow-origin')).toBeNull()
    })

    it('preflight OPTIONS returns 204 on CORS endpoints', async () => {
      const res = await fetch(`${config.baseUrl}/api/auth/challenge`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://other-domain.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
      })
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
    })
  })
}
