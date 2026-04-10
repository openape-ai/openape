import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Isolate HOME so config.ts reads/writes a fresh dir per test.
// ---------------------------------------------------------------------------

const testHome = join(tmpdir(), `apes-refresh-${process.pid}-${Date.now()}`)

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return { ...original, homedir: () => testHome }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IDP = 'http://idp.test'
const EMAIL = 'agent@example.com'

function seedExpiredAuth(opts: { refreshToken?: string } = {}) {
  mkdirSync(join(testHome, '.config', 'apes'), { recursive: true })
  writeFileSync(
    join(testHome, '.config', 'apes', 'auth.json'),
    JSON.stringify({
      idp: IDP,
      access_token: 'expired-token',
      ...(opts.refreshToken ? { refresh_token: opts.refreshToken } : {}),
      email: EMAIL,
      expires_at: 1, // always expired
    }),
    { mode: 0o600 },
  )
}

function seedConfig(toml: string) {
  mkdirSync(join(testHome, '.config', 'apes'), { recursive: true })
  writeFileSync(join(testHome, '.config', 'apes', 'config.toml'), toml, { mode: 0o600 })
}

function readAuth(): any {
  return JSON.parse(readFileSync(join(testHome, '.config', 'apes', 'auth.json'), 'utf-8'))
}

/**
 * Install a fetch mock that drives the various IdP endpoints. Returns a log
 * of every fetch call so tests can assert which endpoints were hit.
 */
function installFetchMock(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string, init?: RequestInit }[] = []
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
    calls.push({ url: urlStr, init })
    return handler(urlStr, init)
  })
  return { calls, spy }
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('apiFetch auto-refresh', () => {
  beforeEach(() => {
    rmSync(testHome, { recursive: true, force: true })
    mkdirSync(testHome, { recursive: true })
    // Discovery cache is module-level — nuke ESM module cache so each test
    // gets a fresh cache and fresh fetch mock.
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('falls back to "run apes login" when neither refresh path is available', async () => {
    seedExpiredAuth() // no refresh_token
    // No config.toml → no agent.key

    const { calls } = installFetchMock(async (url) => {
      // Discovery may still be called; return empty
      if (url.includes('/.well-known/')) return jsonResponse({})
      return new Response('', { status: 404 })
    })

    const { apiFetch } = await import('../src/http')
    await expect(apiFetch('/api/grants')).rejects.toThrow('Not authenticated')
    // Should NOT have called /token since no refresh_token is set
    expect(calls.some(c => c.url.endsWith('/token'))).toBe(false)
  })

  it('uses OAuth refresh_token flow when refresh_token is set and no agent key configured', async () => {
    seedExpiredAuth({ refreshToken: 'rt-original' })

    installFetchMock(async (url, init) => {
      if (url.includes('/.well-known/openid-configuration')) {
        return jsonResponse({
          issuer: IDP,
          token_endpoint: `${IDP}/token`,
        })
      }
      if (url === `${IDP}/token`) {
        const body = init?.body as string
        expect(body).toContain('grant_type=refresh_token')
        expect(body).toContain('refresh_token=rt-original')
        return jsonResponse({
          access_token: 'new-access-token',
          refresh_token: 'rt-rotated',
          expires_in: 300,
        })
      }
      if (url.includes('/api/grants')) {
        expect(init?.headers).toMatchObject({
          Authorization: 'Bearer new-access-token',
        })
        return jsonResponse({ data: [] })
      }
      return new Response('', { status: 404 })
    })

    const { apiFetch } = await import('../src/http')
    const result = await apiFetch<{ data: unknown[] }>('/api/grants')
    expect(result).toEqual({ data: [] })

    // Rotated refresh_token + new access_token must be persisted to auth.json
    const auth = readAuth()
    expect(auth.access_token).toBe('new-access-token')
    expect(auth.refresh_token).toBe('rt-rotated')
    expect(auth.expires_at).toBeGreaterThan(Date.now() / 1000)
  })

  it('keeps the old refresh_token when server does not return a rotated one', async () => {
    seedExpiredAuth({ refreshToken: 'rt-stable' })

    installFetchMock(async (url) => {
      if (url.includes('/.well-known/'))
        return jsonResponse({ token_endpoint: `${IDP}/token` })
      if (url === `${IDP}/token`) {
        return jsonResponse({
          access_token: 'new-access-token',
          expires_in: 300,
          // No refresh_token in response (non-rotating mode)
        })
      }
      if (url.includes('/api/grants'))
        return jsonResponse({ data: [] })
      return new Response('', { status: 404 })
    })

    const { apiFetch } = await import('../src/http')
    await apiFetch('/api/grants')

    const auth = readAuth()
    expect(auth.refresh_token).toBe('rt-stable')
  })

  it('clears refresh_token on 401 from /token to prevent an infinite refresh loop', async () => {
    seedExpiredAuth({ refreshToken: 'rt-revoked' })

    installFetchMock(async (url) => {
      if (url.includes('/.well-known/'))
        return jsonResponse({ token_endpoint: `${IDP}/token` })
      if (url === `${IDP}/token`)
        return jsonResponse({ error: 'invalid_grant' }, { status: 401 })
      return new Response('', { status: 404 })
    })

    const { apiFetch } = await import('../src/http')
    await expect(apiFetch('/api/grants')).rejects.toThrow('Not authenticated')

    const auth = readAuth()
    expect(auth.refresh_token).toBeUndefined()
    // Other fields should be preserved so the user can still see their email etc.
    expect(auth.email).toBe(EMAIL)
  })

  it('clears refresh_token on 400 from /token (invalid_grant)', async () => {
    seedExpiredAuth({ refreshToken: 'rt-bad' })

    installFetchMock(async (url) => {
      if (url.includes('/.well-known/'))
        return jsonResponse({ token_endpoint: `${IDP}/token` })
      if (url === `${IDP}/token`)
        return jsonResponse({ error: 'invalid_grant' }, { status: 400 })
      return new Response('', { status: 404 })
    })

    const { apiFetch } = await import('../src/http')
    await expect(apiFetch('/api/grants')).rejects.toThrow()

    expect(readAuth().refresh_token).toBeUndefined()
  })

  it('prefers ed25519 agent-key refresh over OAuth refresh_token when both are configured', async () => {
    // Set up an agent key that "exists" on disk and a refresh_token in auth.json.
    const keyPath = join(testHome, 'test_key.pem')
    // Generate a real key so loadEd25519PrivateKey() can parse it
    const { privateKey } = generateKeyPairSync('ed25519')
    writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, { mode: 0o600 })
    seedConfig(`[agent]\nkey = "${keyPath}"\n`)
    seedExpiredAuth({ refreshToken: 'rt-unused' })

    const { calls } = installFetchMock(async (url) => {
      if (url.includes('/.well-known/'))
        return jsonResponse({ token_endpoint: `${IDP}/token` })
      if (url.endsWith('/api/agent/challenge'))
        return jsonResponse({ challenge: 'Y2hhbGxlbmdlMTIz' }) // base64
      if (url.endsWith('/api/agent/authenticate')) {
        return jsonResponse({
          token: 'agent-refreshed-token',
          expires_in: 3600,
        })
      }
      if (url.includes('/api/grants'))
        return jsonResponse({ data: [] })
      return new Response('', { status: 404 })
    })

    const { apiFetch } = await import('../src/http')
    await apiFetch('/api/grants')

    // Agent challenge + authenticate hit, /token must NOT have been called
    expect(calls.some(c => c.url.endsWith('/api/agent/challenge'))).toBe(true)
    expect(calls.some(c => c.url.endsWith('/api/agent/authenticate'))).toBe(true)
    expect(calls.some(c => c.url === `${IDP}/token`)).toBe(false)

    expect(readAuth().access_token).toBe('agent-refreshed-token')
  })
})
