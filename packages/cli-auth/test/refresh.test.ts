import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureFreshIdpAuth } from '../src/refresh'
import { loadIdpAuth, saveIdpAuth } from '../src/storage'
import { NotLoggedInError } from '../src/types'

let tmpHome: string
const ORIG = process.env.OPENAPE_CLI_AUTH_HOME

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'cli-auth-refresh-'))
  process.env.OPENAPE_CLI_AUTH_HOME = tmpHome
  vi.restoreAllMocks()
})

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true })
  if (ORIG === undefined) delete process.env.OPENAPE_CLI_AUTH_HOME
  else process.env.OPENAPE_CLI_AUTH_HOME = ORIG
})

describe('ensureFreshIdpAuth', () => {
  it('throws NotLoggedInError when no auth file exists', async () => {
    await expect(ensureFreshIdpAuth(0)).rejects.toThrow(NotLoggedInError)
  })

  it('returns the cached auth when not yet expired', async () => {
    saveIdpAuth({
      idp: 'https://id.openape.ai',
      access_token: 'still-good',
      refresh_token: 'rt',
      email: 'me@x',
      expires_at: 5000,
    })
    const result = await ensureFreshIdpAuth(1000)
    expect(result.access_token).toBe('still-good')
  })

  it('throws NotLoggedInError when token expired and no refresh_token AND no key_path', async () => {
    saveIdpAuth({
      idp: 'https://id.openape.ai',
      access_token: 'expired',
      email: 'me@x',
      expires_at: 100,
    })
    await expect(ensureFreshIdpAuth(2000)).rejects.toThrow(NotLoggedInError)
  })

  it('refreshes an agent token via key challenge-response when refresh_token is missing (#259)', async () => {
    // Write a real Ed25519 PKCS8 key to disk so the in-process signing works.
    const { generateKeyPairSync } = await import('node:crypto')
    const { writeFileSync } = await import('node:fs')
    const { keyObject: priv } = { keyObject: generateKeyPairSync('ed25519').privateKey }
    const pem = priv.export({ format: 'pem', type: 'pkcs8' }).toString()
    const keyPath = join(tmpHome, 'agent-key.pem')
    writeFileSync(keyPath, pem)

    saveIdpAuth({
      idp: 'https://id.openape.ai',
      access_token: 'expired',
      email: 'agent-x+patrick+hofmann_eco@id.openape.ai',
      expires_at: 100,
      key_path: keyPath,
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.endsWith('/.well-known/openid-configuration')) {
        return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (u.endsWith('/api/agent/challenge')) {
        return new Response(JSON.stringify({ challenge: 'YWJj' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }
      if (u.endsWith('/api/agent/authenticate')) {
        return new Response(JSON.stringify({ token: 'fresh-agent-token', expires_in: 3600 }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`unexpected fetch ${u}`)
    })

    const refreshed = await ensureFreshIdpAuth(2000)
    expect(refreshed.access_token).toBe('fresh-agent-token')
    expect(refreshed.expires_at).toBe(2000 + 3600)
    expect(loadIdpAuth()?.access_token).toBe('fresh-agent-token')
    // key_path stays — needed for the next refresh
    expect(loadIdpAuth()?.key_path).toBe(keyPath)

    fetchSpy.mockRestore()
  })

  it('falls back to NotLoggedInError when agent challenge endpoint rejects', async () => {
    const { generateKeyPairSync } = await import('node:crypto')
    const { writeFileSync } = await import('node:fs')
    const priv = generateKeyPairSync('ed25519').privateKey
    const pem = priv.export({ format: 'pem', type: 'pkcs8' }).toString()
    const keyPath = join(tmpHome, 'agent-key.pem')
    writeFileSync(keyPath, pem)

    saveIdpAuth({
      idp: 'https://id.openape.ai',
      access_token: 'expired',
      email: 'agent-x@example',
      expires_at: 100,
      key_path: keyPath,
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.endsWith('/.well-known/openid-configuration')) {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      // IdP rejects the challenge request — refresh path returns null,
      // ensureFreshIdpAuth surfaces the original NotLoggedInError.
      return new Response('rate limited', { status: 429 })
    })

    await expect(ensureFreshIdpAuth(2000)).rejects.toThrow(NotLoggedInError)
    fetchSpy.mockRestore()
  })

  it('refreshes via OIDC and persists the new token', async () => {
    saveIdpAuth({
      idp: 'https://id.openape.ai',
      access_token: 'expired',
      refresh_token: 'rt-current',
      email: 'me@x',
      expires_at: 100,
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (typeof url === 'string' && url.endsWith('/.well-known/openid-configuration')) {
        return new Response(
          JSON.stringify({ token_endpoint: 'https://id.openape.ai/token' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (typeof url === 'string' && url.endsWith('/token')) {
        const body = String((init?.body as URLSearchParams | string) ?? '')
        expect(body).toContain('refresh_token=rt-current')
        return new Response(
          JSON.stringify({
            access_token: 'fresh-access',
            refresh_token: 'rt-rotated',
            expires_in: 900,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      throw new Error(`unexpected fetch ${url}`)
    })

    const refreshed = await ensureFreshIdpAuth(2000)
    expect(refreshed.access_token).toBe('fresh-access')
    expect(refreshed.refresh_token).toBe('rt-rotated')
    expect(refreshed.expires_at).toBe(2000 + 900)

    // Persisted to disk
    expect(loadIdpAuth()?.access_token).toBe('fresh-access')

    fetchSpy.mockRestore()
  })

  it('clears refresh_token and throws NotLoggedInError on 401 from /token', async () => {
    saveIdpAuth({
      idp: 'https://id.openape.ai',
      access_token: 'expired',
      refresh_token: 'rt-revoked',
      email: 'me@x',
      expires_at: 100,
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (typeof url === 'string' && url.endsWith('/.well-known/openid-configuration')) {
        return new Response(
          JSON.stringify({ token_endpoint: 'https://id.openape.ai/token' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{"error":"invalid_grant"}', {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    await expect(ensureFreshIdpAuth(2000)).rejects.toThrow(NotLoggedInError)
    expect(loadIdpAuth()?.refresh_token).toBeUndefined()

    fetchSpy.mockRestore()
  })
})
