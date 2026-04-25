import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuthorizedBearer } from '../src/bearer'
import { exchangeForSpToken } from '../src/exchange'
import { loadSpToken, saveIdpAuth, saveSpToken } from '../src/storage'
import { AuthError } from '../src/types'

let tmpHome: string
const ORIG = process.env.OPENAPE_CLI_AUTH_HOME

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'cli-auth-exch-'))
  process.env.OPENAPE_CLI_AUTH_HOME = tmpHome
  vi.restoreAllMocks()
})

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true })
  if (ORIG === undefined) delete process.env.OPENAPE_CLI_AUTH_HOME
  else process.env.OPENAPE_CLI_AUTH_HOME = ORIG
})

describe('exchangeForSpToken', () => {
  it('POSTs subject_token + scopes and persists the response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      expect(String(url)).toBe('https://plans.openape.ai/api/cli/exchange')
      const body = JSON.parse(String((init?.body as string) ?? '{}'))
      expect(body.subject_token).toBe('idp-eyJ...')
      expect(body.scopes).toEqual(['plans:rw'])
      return new Response(
        JSON.stringify({
          access_token: 'sp-eyJ...',
          token_type: 'Bearer',
          expires_in: 3600,
          aud: 'plans.openape.ai',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      )
    })

    const token = await exchangeForSpToken(
      {
        idp: 'https://id.openape.ai',
        access_token: 'idp-eyJ...',
        email: 'me@x',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
      { endpoint: 'https://plans.openape.ai', aud: 'plans.openape.ai', scopes: ['plans:rw'] },
      1000,
    )

    expect(token.access_token).toBe('sp-eyJ...')
    expect(token.expires_at).toBe(1000 + 3600)
    expect(loadSpToken('plans.openape.ai')?.access_token).toBe('sp-eyJ...')
    fetchSpy.mockRestore()
  })

  it('throws AuthError with hint on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ title: 'Unauthorized', detail: 'aud mismatch' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    await expect(
      exchangeForSpToken(
        { idp: 'x', access_token: 't', email: 'e', expires_at: 9 },
        { endpoint: 'https://plans.openape.ai', aud: 'plans.openape.ai' },
      ),
    ).rejects.toThrow(AuthError)
  })
})

describe('getAuthorizedBearer', () => {
  it('uses cached SP token if not expired', async () => {
    saveIdpAuth({ idp: 'https://id.openape.ai', access_token: 'idp-x', email: 'me@x', expires_at: Math.floor(Date.now() / 1000) + 3600 })
    saveSpToken({
      endpoint: 'https://plans.openape.ai',
      aud: 'plans.openape.ai',
      access_token: 'cached-sp-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const header = await getAuthorizedBearer({
      endpoint: 'https://plans.openape.ai',
      aud: 'plans.openape.ai',
    })
    expect(header).toBe('Bearer cached-sp-token')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('exchanges when no SP token cached', async () => {
    saveIdpAuth({ idp: 'https://id.openape.ai', access_token: 'idp-x', email: 'me@x', expires_at: Math.floor(Date.now() / 1000) + 3600 })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: 'fresh-sp', expires_in: 3600 }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const header = await getAuthorizedBearer({
      endpoint: 'https://plans.openape.ai',
      aud: 'plans.openape.ai',
    })
    expect(header).toBe('Bearer fresh-sp')
    expect(loadSpToken('plans.openape.ai')?.access_token).toBe('fresh-sp')
  })

  it('forceRefresh bypasses cache', async () => {
    saveIdpAuth({ idp: 'https://id.openape.ai', access_token: 'idp-x', email: 'me@x', expires_at: Math.floor(Date.now() / 1000) + 3600 })
    saveSpToken({
      endpoint: 'https://plans.openape.ai',
      aud: 'plans.openape.ai',
      access_token: 'cached-sp',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: 'forced-fresh', expires_in: 3600 }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const header = await getAuthorizedBearer({
      endpoint: 'https://plans.openape.ai',
      aud: 'plans.openape.ai',
      forceRefresh: true,
    })
    expect(header).toBe('Bearer forced-fresh')
  })
})
