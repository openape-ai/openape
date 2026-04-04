import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { toNodeListener } from 'h3'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createIdPApp } from '../idp/app.js'

describe('CORS middleware', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    const instance = createIdPApp({
      issuer: 'http://localhost:0',
      managementToken: 'test-mgmt-token',
      adminEmails: ['admin@example.com'],
    })
    server = createServer(toNodeListener(instance.app))
    await new Promise<void>(resolve => server.listen(0, resolve))
    const addr = server.address() as { port: number }
    baseUrl = `http://localhost:${addr.port}`
  })

  afterAll(() => {
    server.close()
  })

  // --- Helper ---
  function corsHeader(res: Response): string | null {
    return res.headers.get('access-control-allow-origin')
  }

  // --- Routes that SHOULD have CORS ---

  describe('routes with CORS', () => {
    it('OPTIONS /api/auth/challenge returns 204 with CORS headers', async () => {
      const res = await fetch(`${baseUrl}/api/auth/challenge`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://other-domain.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
      })

      expect(res.status).toBe(204)
      expect(corsHeader(res)).toBe('*')
      expect(res.headers.get('access-control-allow-methods')).toContain('POST')
      expect(res.headers.get('access-control-allow-headers')).toContain('Content-Type')
      expect(res.headers.get('access-control-allow-headers')).toContain('Authorization')
    })

    it('GET /.well-known/openid-configuration has CORS headers', async () => {
      const res = await fetch(`${baseUrl}/.well-known/openid-configuration`)
      expect(corsHeader(res)).toBe('*')
    })

    it('GET /.well-known/jwks.json has CORS headers', async () => {
      const res = await fetch(`${baseUrl}/.well-known/jwks.json`)
      expect(corsHeader(res)).toBe('*')
    })

    it('POST /token has CORS headers', async () => {
      const res = await fetch(`${baseUrl}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code', code: 'fake' }),
      })
      expect(corsHeader(res)).toBe('*')
    })

    it('POST /api/grants has CORS headers', async () => {
      const res = await fetch(`${baseUrl}/api/grants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      // We don't care about the response status (will be 4xx without auth),
      // only that CORS headers are present
      expect(corsHeader(res)).toBe('*')
    })

    it('GET /api/grants has CORS headers', async () => {
      const res = await fetch(`${baseUrl}/api/grants`, {
        headers: { Authorization: 'Bearer fake' },
      })
      expect(corsHeader(res)).toBe('*')
    })

    it('POST /api/auth/authenticate has CORS headers', async () => {
      const res = await fetch(`${baseUrl}/api/auth/authenticate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(corsHeader(res)).toBe('*')
    })

    it('POST /api/delegations has CORS headers', async () => {
      const res = await fetch(`${baseUrl}/api/delegations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake' },
        body: JSON.stringify({}),
      })
      expect(corsHeader(res)).toBe('*')
    })

    it('GET /api/delegations has CORS headers', async () => {
      const res = await fetch(`${baseUrl}/api/delegations`, {
        headers: { Authorization: 'Bearer fake' },
      })
      expect(corsHeader(res)).toBe('*')
    })
  })

  // --- Routes that MUST NOT have CORS ---

  describe('routes without CORS', () => {
    it('GET /api/admin/users has no CORS headers', async () => {
      const res = await fetch(`${baseUrl}/api/admin/users`, {
        headers: { Authorization: `Bearer test-mgmt-token` },
      })
      expect(corsHeader(res)).toBeNull()
    })

    it('OPTIONS /api/admin/users has no CORS headers', async () => {
      const res = await fetch(`${baseUrl}/api/admin/users`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://other-domain.com',
          'Access-Control-Request-Method': 'GET',
        },
      })
      expect(corsHeader(res)).toBeNull()
    })

    it('POST /api/session/login has no CORS headers', async () => {
      const res = await fetch(`${baseUrl}/api/session/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'x', password: 'y' }),
      })
      expect(corsHeader(res)).toBeNull()
    })

    it('GET /authorize has no CORS headers', async () => {
      const res = await fetch(`${baseUrl}/authorize?client_id=x&redirect_uri=x&response_type=code`, {
        redirect: 'manual',
      })
      expect(corsHeader(res)).toBeNull()
    })

    it('GET /login has no CORS headers', async () => {
      const res = await fetch(`${baseUrl}/login`)
      expect(corsHeader(res)).toBeNull()
    })
  })

  // --- Preflight details ---

  describe('preflight handling', () => {
    it('OPTIONS /api/auth/challenge returns correct preflight headers', async () => {
      const res = await fetch(`${baseUrl}/api/auth/challenge`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://other-domain.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
      })

      expect(res.status).toBe(204)
      expect(corsHeader(res)).toBe('*')

      const allowMethods = res.headers.get('access-control-allow-methods')
      expect(allowMethods).toContain('GET')
      expect(allowMethods).toContain('POST')
      expect(allowMethods).toContain('PUT')
      expect(allowMethods).toContain('DELETE')
      expect(allowMethods).toContain('OPTIONS')

      const allowHeaders = res.headers.get('access-control-allow-headers')
      expect(allowHeaders).toContain('Content-Type')
      expect(allowHeaders).toContain('Authorization')
    })

    it('OPTIONS /token returns preflight with 204', async () => {
      const res = await fetch(`${baseUrl}/token`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://sp.example.com',
          'Access-Control-Request-Method': 'POST',
        },
      })

      expect(res.status).toBe(204)
      expect(corsHeader(res)).toBe('*')
    })

    it('OPTIONS /.well-known/jwks.json returns preflight with 204', async () => {
      const res = await fetch(`${baseUrl}/.well-known/jwks.json`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://sp.example.com',
          'Access-Control-Request-Method': 'GET',
        },
      })

      expect(res.status).toBe(204)
      expect(corsHeader(res)).toBe('*')
    })

    it('OPTIONS /api/delegations returns preflight with 204', async () => {
      const res = await fetch(`${baseUrl}/api/delegations`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://sp.example.com',
          'Access-Control-Request-Method': 'POST',
        },
      })

      expect(res.status).toBe(204)
      expect(corsHeader(res)).toBe('*')
    })
  })
})
