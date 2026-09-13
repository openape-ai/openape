// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { CredentialCache } from '../../src/main/connections/cache'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const cipher = { available: () => true, encrypt: (value: string) => Buffer.from(Array.from(Buffer.from(value), byte => byte ^ 0x5A)), decrypt: (value: Buffer) => Buffer.from(Array.from(value, byte => byte ^ 0x5A)).toString() }
describe('tool-only credential cache', () => {
  it('serializes refreshed cache transactions and removes plaintext after use', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pods-cache-')); roots.push(root)
    const cache = new CredentialCache(root, cipher); const id = randomUUID()
    await cache.connect(id, '{"refresh":"SYNTHETIC_INITIAL"}')
    let firstStarted: () => void = () => {}; let finishFirst: () => void = () => {}
    const started = new Promise<void>((resolve) => { firstStarted = resolve }); const release = new Promise<void>((resolve) => { finishFirst = resolve })
    const first = cache.withCache(id, async (file) => { firstStarted(); await release; await writeFile(file, '{"refresh":"SYNTHETIC_REFRESHED"}'); return 'first' })
    await started
    let secondEntered = false
    const second = cache.withCache(id, async (file) => { secondEntered = true; expect(await readFile(file, 'utf8')).toContain('SYNTHETIC_REFRESHED'); return 'second' })
    expect(secondEntered).toBe(false); finishFirst()
    expect(await Promise.all([first, second])).toEqual(['first', 'second'])
    expect(await readdir(join(root, 'temporary'))).toEqual([])
    expect((await readFile(join(root, `${id}.encrypted`))).includes(Buffer.from('SYNTHETIC'))).toBe(false)
    const reopened = new CredentialCache(root, cipher)
    await reopened.withCache(id, async file => expect(await readFile(file, 'utf8')).toContain('SYNTHETIC_REFRESHED'))
  })
  it('retains a valid rotated token when the subsequent read fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pods-cache-')); roots.push(root)
    const id = randomUUID(); const cache = new CredentialCache(root, cipher)
    await cache.connect(id, '{"refresh":"OLD_FIXTURE"}')
    await expect(cache.withCache(id, async (file) => {
      await writeFile(file, '{"refresh":"ROTATED_FIXTURE"}')
      throw new Error('Mail read failed after successful refresh')
    })).rejects.toThrow('Mail read failed')
    await cache.withCache(id, async file => expect(await readFile(file, 'utf8')).toContain('ROTATED_FIXTURE'))
  })
  it('blocks a locked store and preserves last valid encrypted cache on corrupt tool output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pods-cache-')); roots.push(root)
    const id = randomUUID(); const cache = new CredentialCache(root, cipher)
    await cache.connect(id, '{"refresh":"VALID_FIXTURE"}')
    const before = await readFile(join(root, `${id}.encrypted`))
    await expect(cache.withCache(id, async (file) => { await writeFile(file, 'corrupt'); return null })).rejects.toThrow('JSON')
    expect(await readFile(join(root, `${id}.encrypted`))).toEqual(before)
    const locked = new CredentialCache(root, { ...cipher, available: () => false })
    await expect(locked.withCache(id, async () => 'must not run')).rejects.toThrow('locked')
    expect(await readdir(join(root, 'temporary'))).toEqual([])
  })
})
