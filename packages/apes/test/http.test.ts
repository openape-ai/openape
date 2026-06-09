import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createIdPApp } from '@openape/server'

// ---------------------------------------------------------------------------
// Isolate HOME
// ---------------------------------------------------------------------------

const testHome = join(tmpdir(), `apes-http-${process.pid}-${Date.now()}`)
mkdirSync(testHome, { recursive: true })

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return { ...original, homedir: () => testHome }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function listenOnFreePort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') resolve(addr.port)
      else reject(new Error('Failed to get server address'))
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('http module', () => {
  let server: Server
  let idpBase: string

  beforeAll(async () => {
    const idp = createIdPApp({
      issuer: 'http://placeholder',
      managementToken: 'test-http-token',
    })
    const tempServer = createServer(toNodeListener(idp.app))
    const port = await listenOnFreePort(tempServer)
    await closeServer(tempServer)

    idpBase = `http://127.0.0.1:${port}`

    const idp2 = createIdPApp({
      issuer: idpBase,
      managementToken: 'test-http-token',
    })
    server = createServer(toNodeListener(idp2.app))
    await new Promise<void>((resolve, reject) => {
      server.listen(port, '127.0.0.1', () => resolve())
      server.on('error', reject)
    })

    process.env.APES_IDP = idpBase
  })

  afterAll(async () => {
    delete process.env.APES_IDP
    await closeServer(server)
    rmSync(testHome, { recursive: true, force: true })
  })

  describe('discoverEndpoints', () => {
    it('fetches OIDC discovery document', async () => {
      const { discoverEndpoints } = await import('../src/http')

      const disco = await discoverEndpoints(idpBase)
      expect(disco.issuer).toBe(idpBase)
      expect(disco.openape_grants_endpoint).toBe(`${idpBase}/api/grants`)
      expect(disco.openape_delegations_endpoint).toBe(`${idpBase}/api/delegations`)
    })

    it('caches discovery results', async () => {
      const { discoverEndpoints } = await import('../src/http')

      // The module-level cache persists within a single test run
      const disco1 = await discoverEndpoints(idpBase)
      const disco2 = await discoverEndpoints(idpBase)
      expect(disco1).toEqual(disco2)
    })

    it('returns empty object for unreachable IdP', async () => {
      const { discoverEndpoints } = await import('../src/http')

      const disco = await discoverEndpoints('http://127.0.0.1:1')
      expect(disco).toEqual({})
    })
  })

  describe('getGrantsEndpoint', () => {
    it('returns grants endpoint from discovery', async () => {
      const { getGrantsEndpoint } = await import('../src/http')

      const endpoint = await getGrantsEndpoint(idpBase)
      expect(endpoint).toBe(`${idpBase}/api/grants`)
    })

    it('falls back to default when discovery fails', async () => {
      const { getGrantsEndpoint } = await import('../src/http')

      const endpoint = await getGrantsEndpoint('http://127.0.0.1:1')
      expect(endpoint).toBe('http://127.0.0.1:1/api/grants')
    })
  })

  describe('getDelegationsEndpoint', () => {
    it('returns delegations endpoint from discovery', async () => {
      const { getDelegationsEndpoint } = await import('../src/http')

      const endpoint = await getDelegationsEndpoint(idpBase)
      expect(endpoint).toBe(`${idpBase}/api/delegations`)
    })
  })

  describe('getAgentChallengeEndpoint', () => {
    it('reads canonical ddisa_auth_challenge_endpoint from discovery', async () => {
      const { getAgentChallengeEndpoint } = await import('../src/http')

      const endpoint = await getAgentChallengeEndpoint(idpBase)
      // Fixed (M3): client now reads ddisa_auth_challenge_endpoint — the canonical key
      // emitted by the server — instead of the legacy ddisa_agent_challenge_endpoint.
      expect(endpoint).toBe(`${idpBase}/api/auth/challenge`)
    })
  })

  describe('getAgentAuthenticateEndpoint', () => {
    it('reads canonical ddisa_auth_authenticate_endpoint from discovery', async () => {
      const { getAgentAuthenticateEndpoint } = await import('../src/http')

      const endpoint = await getAgentAuthenticateEndpoint(idpBase)
      // Fixed (M3): client now reads ddisa_auth_authenticate_endpoint — the canonical key
      // emitted by the server — instead of the legacy ddisa_agent_authenticate_endpoint.
      expect(endpoint).toBe(`${idpBase}/api/auth/authenticate`)
    })
  })

  describe('apiFetch', () => {
    it('throws when no token available', async () => {
      const { apiFetch } = await import('../src/http')

      // No auth file exists, no token passed
      await expect(
        apiFetch('/api/grants'),
      ).rejects.toThrow('Not authenticated')
    })

    it('throws ApiError with problem details for invalid token', async () => {
      const { apiFetch, ApiError } = await import('../src/http')

      // An arbitrary token that is not a valid JWT will be rejected
      try {
        await apiFetch(`${idpBase}/api/grants`, {
          token: 'not-a-valid-jwt',
        })
        expect.unreachable('Should have thrown')
      }
      catch (err) {
        expect(err).toBeInstanceOf(ApiError)
        expect((err as any).statusCode).toBe(401)
      }
    })

    it('throws ApiError on non-200 response', async () => {
      const { apiFetch } = await import('../src/http')

      await expect(
        apiFetch(`${idpBase}/api/grants/nonexistent-id`, {
          token: 'test-http-token',
        }),
      ).rejects.toThrow()
    })

    it('retries on 429 then succeeds (rate-limit backoff)', async () => {
      vi.useFakeTimers()
      const { apiFetch } = await import('../src/http')
      let calls = 0
      vi.stubGlobal('fetch', vi.fn(async () => {
        calls += 1
        return calls === 1
          ? new Response('{"detail":"rate limited"}', { status: 429, headers: { 'content-type': 'application/problem+json' } })
          : new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
      }))
      try {
        const promise = apiFetch<{ ok: boolean }>('http://idp.test/api/x', { token: 'tkn' })
        await vi.runAllTimersAsync() // fast-forward the backoff sleep
        await expect(promise).resolves.toEqual({ ok: true })
        expect(calls).toBe(2) // one 429 + one retry that succeeds
      }
      finally {
        vi.unstubAllGlobals()
        vi.useRealTimers()
      }
    })

    it('gives up after the retry cap (throws 429)', async () => {
      vi.useFakeTimers()
      const { apiFetch, ApiError } = await import('../src/http')
      let calls = 0
      vi.stubGlobal('fetch', vi.fn(async () => {
        calls += 1
        return new Response('{"detail":"rate limited"}', { status: 429, headers: { 'content-type': 'application/problem+json' } })
      }))
      try {
        const promise = apiFetch('http://idp.test/api/x', { token: 'tkn' }).catch((e: unknown) => e)
        await vi.runAllTimersAsync()
        const err = await promise
        expect(err).toBeInstanceOf(ApiError)
        expect((err as { statusCode: number }).statusCode).toBe(429)
        expect(calls).toBe(4) // initial + 3 retries
      }
      finally {
        vi.unstubAllGlobals()
        vi.useRealTimers()
      }
    })
  })
})
