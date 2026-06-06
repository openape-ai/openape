import { generateX25519KeyPair, seal } from '@openape/core'
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { materializeSecrets } from '../src/lib/agent-secrets-runtime'

let dir: string
let keyPath: string
const kp = generateX25519KeyPair()

function writeBlob(env: string, value: string): void {
  writeFileSync(join(dir, `${env}.blob`), JSON.stringify(seal(value, kp.publicKey)))
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apes-secrets-'))
  keyPath = join(dir, 'agent-x25519.key')
  writeFileSync(keyPath, kp.privateKey)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('materializeSecrets', () => {
  it('opens sealed blobs and injects them into the env map', () => {
    writeBlob('BLUESKY_APP_PASSWORD', 'hunter2')
    writeBlob('BLUESKY_HANDLE', 'me.bsky.social')
    const env: NodeJS.ProcessEnv = {}
    const r = materializeSecrets({ dir, keyPath, env })
    expect(r.applied.toSorted()).toEqual(['BLUESKY_APP_PASSWORD', 'BLUESKY_HANDLE'])
    expect(env.BLUESKY_APP_PASSWORD).toBe('hunter2')
    expect(env.BLUESKY_HANDLE).toBe('me.bsky.social')
  })

  it('does nothing when the agent has no key', () => {
    writeBlob('TOKEN', 'v')
    const env: NodeJS.ProcessEnv = {}
    const r = materializeSecrets({ dir, keyPath: join(dir, 'missing.key'), env })
    expect(r.applied).toEqual([])
    expect(env.TOKEN).toBeUndefined()
  })

  it('skips corrupt / foreign blobs without throwing', () => {
    writeBlob('GOOD', 'ok')
    writeFileSync(join(dir, 'BAD.blob'), 'not json')
    const other = generateX25519KeyPair()
    writeFileSync(join(dir, 'FOREIGN.blob'), JSON.stringify(seal('x', other.publicKey)))
    const env: NodeJS.ProcessEnv = {}
    const r = materializeSecrets({ dir, keyPath, env })
    expect(r.applied).toEqual(['GOOD'])
    expect(r.failed.toSorted()).toEqual(['BAD.blob', 'FOREIGN.blob'])
    expect(env.GOOD).toBe('ok')
  })

  it('ignores non-blob and non-UPPER_SNAKE files', () => {
    writeBlob('REAL', 'v')
    writeFileSync(join(dir, 'readme.txt'), 'x')
    writeFileSync(join(dir, 'lower.blob'), 'x')
    const env: NodeJS.ProcessEnv = {}
    const r = materializeSecrets({ dir, keyPath, env })
    expect(r.applied).toEqual(['REAL'])
  })

  it('revokes: an env applied before but with no blob now is deleted', () => {
    writeBlob('KEEP', 'k')
    const env: NodeJS.ProcessEnv = { GONE: 'old', KEEP: 'old' }
    const r = materializeSecrets({ dir, keyPath, env, previouslyApplied: ['GONE', 'KEEP'] })
    expect(r.applied).toEqual(['KEEP'])
    expect(env.KEEP).toBe('k')
    expect(env.GONE).toBeUndefined()
  })
})

describe('materializeSecrets — file targets', () => {
  function writeFileBlob(name: string, value: string, materializeTo: string): void {
    writeFileSync(join(dir, `${name}.blob`), JSON.stringify({ ...seal(value, kp.publicKey), materializeTo }))
  }

  it('writes the unsealed content to the target file (mode 0600), not the env', () => {
    const target = join(dir, 'out', 'auth.json')
    writeFileBlob('CHATGPT_AUTH_JSON', '{"token":"abc"}', target)
    const env: NodeJS.ProcessEnv = {}
    const r = materializeSecrets({ dir, keyPath, env })
    expect(r.applied).toEqual(['CHATGPT_AUTH_JSON'])
    expect(readFileSync(target, 'utf8')).toBe('{"token":"abc"}')
    expect(statSync(target).mode & 0o777).toBe(0o600)
    expect(env.CHATGPT_AUTH_JSON).toBeUndefined()
  })

  it('seed-once: leaves a target file that is newer than the blob untouched', () => {
    const target = join(dir, 'auth.json')
    writeFileSync(target, 'LIVE-refreshed-by-litellm')
    writeFileBlob('CHATGPT_AUTH_JSON', 'STALE-from-troop', target)
    utimesSync(join(dir, 'CHATGPT_AUTH_JSON.blob'), new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))
    utimesSync(target, new Date('2026-01-02T00:00:00Z'), new Date('2026-01-02T00:00:00Z'))
    materializeSecrets({ dir, keyPath, env: {} })
    expect(readFileSync(target, 'utf8')).toBe('LIVE-refreshed-by-litellm')
  })

  it('re-verify: a blob newer than the target overwrites it', () => {
    const target = join(dir, 'auth.json')
    writeFileSync(target, 'OLD')
    writeFileBlob('CHATGPT_AUTH_JSON', 'FRESH-reverify', target)
    utimesSync(target, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))
    utimesSync(join(dir, 'CHATGPT_AUTH_JSON.blob'), new Date('2026-01-02T00:00:00Z'), new Date('2026-01-02T00:00:00Z'))
    materializeSecrets({ dir, keyPath, env: {} })
    expect(readFileSync(target, 'utf8')).toBe('FRESH-reverify')
  })
})
