import { generateX25519KeyPair, seal } from '@openape/core'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
