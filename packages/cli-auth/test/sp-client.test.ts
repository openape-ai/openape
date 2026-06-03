import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createSpClient } from '../src/sp-client'
import { saveIdpAuth, saveSpToken } from '../src/storage'

let tmpHome: string
const ORIG_AUTH_HOME = process.env.OPENAPE_CLI_AUTH_HOME
const ORIG_ENDPOINT_ENV = process.env.APE_TEST_ENDPOINT

function makeClient(overrides?: Partial<Parameters<typeof createSpClient>[0]>) {
  return createSpClient({
    defaultEndpoint: 'https://test.openape.ai',
    envVar: 'APE_TEST_ENDPOINT',
    configFile: 'auth-test.json',
    defaultAud: 'test.openape.ai',
    ...overrides,
  })
}

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'cli-auth-spclient-'))
  // Point OPENAPE_CLI_AUTH_HOME so storage helpers (saveIdpAuth, saveSpToken)
  // write to the temp dir — keeps tests hermetic.
  process.env.OPENAPE_CLI_AUTH_HOME = tmpHome
  vi.restoreAllMocks()
  delete process.env.APE_TEST_ENDPOINT
})

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true })
  if (ORIG_AUTH_HOME === undefined) delete process.env.OPENAPE_CLI_AUTH_HOME
  else process.env.OPENAPE_CLI_AUTH_HOME = ORIG_AUTH_HOME
  if (ORIG_ENDPOINT_ENV === undefined) delete process.env.APE_TEST_ENDPOINT
  else process.env.APE_TEST_ENDPOINT = ORIG_ENDPOINT_ENV
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// endpoint resolution precedence
// ---------------------------------------------------------------------------

describe('resolveEndpoint', () => {
  it('falls back to defaultEndpoint when nothing else is set', () => {
    const client = makeClient()
    expect(client.resolveEndpoint()).toBe('https://test.openape.ai')
  })

  it('env var takes precedence over default', () => {
    process.env.APE_TEST_ENDPOINT = 'https://env.openape.ai/'
    const client = makeClient()
    expect(client.resolveEndpoint()).toBe('https://env.openape.ai')
  })

  it('explicit override takes precedence over env var', () => {
    process.env.APE_TEST_ENDPOINT = 'https://env.openape.ai'
    const client = makeClient()
    expect(client.resolveEndpoint('https://explicit.openape.ai')).toBe('https://explicit.openape.ai')
  })

  it('stored endpoint takes precedence over default but not env var', () => {
    // We cannot easily redirect configPath in the test, so we write the
    // config file using the client's own saveConfig to prove the round-trip.
    const client = makeClient({ configFile: `auth-test-${Date.now()}.json` })
    client.saveConfig({ endpoint: 'https://stored.openape.ai' })

    // No env var → falls through to stored value
    expect(client.resolveEndpoint()).toBe('https://stored.openape.ai')

    // Env var overrides stored
    process.env.APE_TEST_ENDPOINT = 'https://env.openape.ai'
    expect(client.resolveEndpoint()).toBe('https://env.openape.ai')
  })

  it('strips trailing slash from all sources', () => {
    const client = makeClient()
    expect(client.resolveEndpoint('https://x.openape.ai/')).toBe('https://x.openape.ai')
  })
})

// ---------------------------------------------------------------------------
// config load/save round-trip
// ---------------------------------------------------------------------------

describe('loadConfig / saveConfig', () => {
  it('returns {} when no config file exists', () => {
    const client = makeClient({ configFile: `auth-missing-${Date.now()}.json` })
    expect(client.loadConfig()).toEqual({})
  })

  it('persists and reloads a generic state blob', () => {
    const client = makeClient({ configFile: `auth-roundtrip-${Date.now()}.json` })
    client.saveConfig({ endpoint: 'https://x.openape.ai', customKey: 'value' })
    const loaded = client.loadConfig()
    expect(loaded.endpoint).toBe('https://x.openape.ai')
    expect((loaded as { customKey?: string }).customKey).toBe('value')
  })

  it('writes a mode-600 file', () => {
    const client = makeClient({ configFile: `auth-mode-${Date.now()}.json` })
    client.saveConfig({ endpoint: 'https://x' })
    const mode = statSync(client.configPath).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('returns {} on corrupted JSON instead of throwing', () => {
    const client = makeClient({ configFile: `auth-corrupt-${Date.now()}.json` })
    mkdirSync(dirname(client.configPath), { recursive: true })
    writeFileSync(client.configPath, '{not-json')
    expect(client.loadConfig()).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// apiCall — bearer injection and ApiError surfacing
// ---------------------------------------------------------------------------

describe('apiCall', () => {
  beforeEach(() => {
    // Seed auth + SP token so getAuthorizedBearer succeeds without network.
    const now = Math.floor(Date.now() / 1000)
    saveIdpAuth({ idp: 'https://id.openape.ai', access_token: 'idp-x', email: 'me@x', expires_at: now + 3600 })
    saveSpToken({
      endpoint: 'https://test.openape.ai',
      aud: 'test.openape.ai',
      access_token: 'sp-tok',
      expires_at: now + 3600,
    })
  })

  it('injects Authorization: Bearer header on requests', async () => {
    const client = makeClient()
    let capturedHeaders: Record<string, string> = {}
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      capturedHeaders = Object.fromEntries(new Headers(init?.headers as Record<string, string>).entries())
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    await client.apiCall('/api/ping')
    expect(capturedHeaders.authorization).toBe('Bearer sp-tok')
  })

  it('throws ApiError on non-2xx with title + status', async () => {
    const client = makeClient()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({ title: 'Not Found', detail: 'resource missing' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    let thrown: unknown
    try {
      await client.apiCall('/api/missing')
    }
    catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(ApiError)
    if (thrown instanceof ApiError) {
      expect(thrown.status).toBe(404)
      expect(thrown.title).toBe('Not Found')
      expect(thrown.detail).toBe('resource missing')
    }
  })

  it('_request is an alias for apiCall', async () => {
    const client = makeClient()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const result = await client._request<number[]>('/api/items')
    expect(result).toEqual([1, 2, 3])
  })

  it('uses explicit endpoint override when provided', async () => {
    const client = makeClient()
    let capturedUrl = ''
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = String(url)
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    await client.apiCall('/api/rooms', { endpoint: 'https://override.openape.ai' })
    expect(capturedUrl).toBe('https://override.openape.ai/api/rooms')
  })
})

// ---------------------------------------------------------------------------
// ApiError constructor
// ---------------------------------------------------------------------------

describe('ApiError', () => {
  it('formats message with detail', () => {
    const err = new ApiError(422, 'Validation failed', 'email must be valid')
    expect(err.message).toBe('Validation failed: email must be valid')
    expect(err.status).toBe(422)
    expect(err.title).toBe('Validation failed')
    expect(err.detail).toBe('email must be valid')
    expect(err.name).toBe('ApiError')
  })

  it('formats message without detail', () => {
    const err = new ApiError(503, 'Service unavailable')
    expect(err.message).toBe('Service unavailable')
    expect(err.detail).toBeUndefined()
  })
})
