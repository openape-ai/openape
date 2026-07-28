import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// #1066: the adapter path resolves auth here, independently of @openape/apes.
// Without APES_AUTH_FILE support a wrapper running under an alternate identity
// (worker operator) silently falls back to the real user's auth.json — grants
// then carry the wrong requester and are judged against the wrong YOLO policy.
//
// HOME is sandboxed in every case: the module resolves the default path from
// homedir() at import time, and a test must never read or write the real one.
const realHome = process.env.HOME

async function importConfigWith(authFile: string | undefined) {
  const home = mkdtempSync(join(tmpdir(), 'shapes-home-'))
  mkdirSync(join(home, '.config', 'apes'), { recursive: true })
  process.env.HOME = home
  if (authFile === undefined)
    delete process.env.APES_AUTH_FILE
  else
    process.env.APES_AUTH_FILE = authFile
  vi.resetModules()
  return { mod: await import('../src/config.js'), home }
}

describe('APES_AUTH_FILE override (#1066)', () => {
  beforeEach(() => {
    delete process.env.APES_AUTH_FILE
  })

  afterEach(() => {
    delete process.env.APES_AUTH_FILE
    process.env.HOME = realHome
    vi.resetModules()
  })

  it('loadAuth reads the overridden file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shapes-auth-'))
    const file = join(dir, 'operator-auth.json')
    writeFileSync(file, JSON.stringify({
      email: 'operator@id.example',
      idp: 'https://id.example',
      access_token: 'op-token',
      expires_at: 9999999999,
    }))

    const { mod } = await importConfigWith(file)
    expect(mod.loadAuth()?.email).toBe('operator@id.example')
    expect(mod.getRequesterIdentity()).toBe('operator@id.example')
  })

  it('falls back to the home auth.json when the override is unset', async () => {
    const { mod, home } = await importConfigWith(undefined)
    writeFileSync(join(home, '.config', 'apes', 'auth.json'), JSON.stringify({
      email: 'human@id.example',
      idp: 'https://id.example',
      access_token: 'human-token',
      expires_at: 9999999999,
    }))
    expect(mod.loadAuth()?.email).toBe('human@id.example')
  })

  it('returns null when the overridden file does not exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shapes-auth-'))
    const { mod } = await importConfigWith(join(dir, 'missing.json'))
    expect(mod.loadAuth()).toBeNull()
  })
})
