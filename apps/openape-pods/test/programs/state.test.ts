import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm, symlink, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { CredentialCache } from '../../src/main/connections/cache'
import { ProgramState } from '../../src/main/programs/state'

it('keeps application state scoped, preserves multiple files and retains the previous generation after a failed session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pods-program-state-'))
  const cache = new CredentialCache(root, { available: () => true, encrypt: value => Buffer.from(value), decrypt: value => value.toString() })
  const state = new ProgramState(cache); const binding = { podId: randomUUID(), applicationId: randomUUID() }
  try {
    const id = await state.create(binding)
    await state.use(id, binding, async (path) => { await mkdir(join(path, 'config')); await writeFile(join(path, 'config/account.db'), Buffer.from([0, 1, 255])); await writeFile(join(path, 'token.json'), '{"token":"synthetic"}') })
    await state.use(id, binding, async (path) => { expect(await readFile(join(path, 'config/account.db'))).toEqual(Buffer.from([0, 1, 255])); expect(await readFile(join(path, 'token.json'), 'utf8')).toContain('synthetic') })
    await expect(state.use(id, { ...binding, podId: randomUUID() }, async () => {})).rejects.toThrow('another application or pod')
    await expect(state.use(id, { ...binding, applicationId: randomUUID() }, async () => {})).rejects.toThrow('another application or pod')
    await expect(cache.readScriptSecret(id, binding.podId, 'token')).rejects.toThrow('not a script credential')
    await expect(state.use(id, binding, async (path) => { await writeFile(join(path, 'token.json'), 'broken'); throw new Error('Session did not close cleanly') })).rejects.toThrow('did not close')
    await state.use(id, binding, async path => expect(await readFile(join(path, 'token.json'), 'utf8')).toBe('{"token":"synthetic"}'))
    const canary = join(root, 'canary'); await writeFile(canary, 'SYNTHETIC_HOST_CANARY')
    await expect(state.use(id, binding, async path => symlink(canary, join(path, 'escape')))).rejects.toThrow('links or special files')
    await expect(state.use(id, binding, async path => writeFile(join(path, 'oversized'), Buffer.alloc(4 * 1024 * 1024 + 1)))).rejects.toThrow('size limit')
    await state.use(id, binding, async path => expect(await readFile(join(path, 'token.json'), 'utf8')).toBe('{"token":"synthetic"}'))
    await cache.erasePodKey(id, binding.podId)
  }
  finally { await rm(root, { recursive: true, force: true }) }
})
