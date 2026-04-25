import { mkdtempSync, rmSync, writeFileSync as fsWriteFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearAllSpTokens,
  clearIdpAuth,
  clearSpToken,
  getAuthFile,
  getConfigDir,
  getSpTokensDir,
  loadIdpAuth,
  loadSpToken,
  saveIdpAuth,
  saveSpToken,
} from '../src/storage'

let tmpHome: string
const ORIG = process.env.OPENAPE_CLI_AUTH_HOME

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'cli-auth-storage-'))
  process.env.OPENAPE_CLI_AUTH_HOME = tmpHome
})

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true })
  if (ORIG === undefined) delete process.env.OPENAPE_CLI_AUTH_HOME
  else process.env.OPENAPE_CLI_AUTH_HOME = ORIG
})

describe('storage paths', () => {
  it('honors OPENAPE_CLI_AUTH_HOME override', () => {
    expect(getConfigDir()).toBe(tmpHome)
    expect(getAuthFile()).toBe(join(tmpHome, 'auth.json'))
    expect(getSpTokensDir()).toBe(join(tmpHome, 'sp-tokens'))
  })
})

describe('IdP auth roundtrip', () => {
  it('returns null when no auth file exists', () => {
    expect(loadIdpAuth()).toBeNull()
  })

  it('persists and reloads an IdP auth blob', () => {
    saveIdpAuth({
      idp: 'https://id.openape.ai',
      access_token: 'eyJ...',
      refresh_token: 'rt-abc',
      email: 'patrick@hofmann.eco',
      expires_at: 1234567890,
    })
    const loaded = loadIdpAuth()
    expect(loaded?.access_token).toBe('eyJ...')
    expect(loaded?.refresh_token).toBe('rt-abc')
  })

  it('clearIdpAuth empties the file', () => {
    saveIdpAuth({
      idp: 'https://id.openape.ai',
      access_token: 'x',
      email: 'me@x',
      expires_at: 1,
    })
    clearIdpAuth()
    expect(loadIdpAuth()).toBeNull()
  })

  it('returns null on corrupted JSON instead of throwing', () => {
    saveIdpAuth({
      idp: 'https://id.openape.ai',
      access_token: 'x',
      email: 'me@x',
      expires_at: 1,
    })
    // Corrupt the file in place
    fsWriteFileSync(getAuthFile(), '{not-json', { mode: 0o600 })
    expect(loadIdpAuth()).toBeNull()
  })
})

describe('SP token roundtrip', () => {
  it('returns null for unknown audience', () => {
    expect(loadSpToken('plans.openape.ai')).toBeNull()
  })

  it('persists and reloads an SP token', () => {
    saveSpToken({
      endpoint: 'https://plans.openape.ai',
      aud: 'plans.openape.ai',
      access_token: 'sp-eyJ...',
      expires_at: 1234567890,
      scopes: ['plans:rw'],
    })
    const loaded = loadSpToken('plans.openape.ai')
    expect(loaded?.access_token).toBe('sp-eyJ...')
    expect(loaded?.scopes).toEqual(['plans:rw'])
  })

  it('clearSpToken removes a single audience', () => {
    saveSpToken({
      endpoint: 'https://plans.openape.ai',
      aud: 'plans.openape.ai',
      access_token: 'a',
      expires_at: 1,
    })
    saveSpToken({
      endpoint: 'https://tasks.openape.ai',
      aud: 'tasks.openape.ai',
      access_token: 'b',
      expires_at: 2,
    })
    clearSpToken('plans.openape.ai')
    expect(loadSpToken('plans.openape.ai')).toBeNull()
    expect(loadSpToken('tasks.openape.ai')?.access_token).toBe('b')
  })

  it('clearAllSpTokens wipes every cached entry', () => {
    saveSpToken({ endpoint: 'a', aud: 'a', access_token: 'a', expires_at: 1 })
    saveSpToken({ endpoint: 'b', aud: 'b', access_token: 'b', expires_at: 2 })
    clearAllSpTokens()
    expect(loadSpToken('a')).toBeNull()
    expect(loadSpToken('b')).toBeNull()
  })

  it('audience-with-special-chars maps to a safe filename', () => {
    saveSpToken({
      endpoint: 'https://x',
      aud: 'weird/audience:with*chars',
      access_token: 'safe',
      expires_at: 1,
    })
    expect(loadSpToken('weird/audience:with*chars')?.access_token).toBe('safe')
  })
})
