import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// #1062: APES_AUTH_FILE lets a wrapper run apes/ape-shell under an
// alternate identity (e.g. the worker's operator agent) without
// touching HOME. The module resolves the path at import time, so each
// test re-imports with a fresh module registry.
async function importConfigWith(authFile: string | undefined) {
  if (authFile === undefined)
    delete process.env.APES_AUTH_FILE
  else
    process.env.APES_AUTH_FILE = authFile
  vi.resetModules()
  return import('../src/config.js')
}

describe('APES_AUTH_FILE override (#1062)', () => {
  afterEach(() => {
    delete process.env.APES_AUTH_FILE
    vi.resetModules()
  })

  it('loadAuth reads from the overridden path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apes-auth-'))
    const file = join(dir, 'operator-auth.json')
    writeFileSync(file, JSON.stringify({
      email: 'operator@id.example',
      idp: 'https://id.example',
      access_token: 'tok',
    }))

    const { loadAuth } = await importConfigWith(file)
    expect(loadAuth()?.email).toBe('operator@id.example')
  })

  it('loadAuth returns null when the overridden path does not exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apes-auth-'))
    const { loadAuth } = await importConfigWith(join(dir, 'missing.json'))
    expect(loadAuth()).toBeNull()
  })

  it('saveAuth writes to the overridden path (existing directory)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apes-auth-'))
    const file = join(dir, 'operator-auth.json')

    const { saveAuth } = await importConfigWith(file)
    saveAuth({ email: 'operator@id.example', idp: 'https://id.example', access_token: 'tok2' })
    expect(JSON.parse(readFileSync(file, 'utf-8')).access_token).toBe('tok2')
  })
})
