// @vitest-environment node
import { mkdtemp, writeFile, chmod, symlink, link, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { importPrivateSecret } from '../../src/main/codex/secret-import'
import { setMandatorySecretPaths } from '../../src/runtime/secret-paths'

afterEach(() => setMandatorySecretPaths([]))

it('passes a private file to the credential store and returns only its safe receipt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pods-secret-import-'))
  try {
    const file = join(directory, 'secret'); await writeFile(file, 'synthetic-private-value\n', { mode: 0o600 })
    const save = vi.fn(async () => ({ epoch: 2 }))
    expect(await importPrivateSecret(file, save)).toEqual({ epoch: 2 })
    expect(save).toHaveBeenCalledWith('synthetic-private-value')
    await chmod(file, 0o644)
    await expect(importPrivateSecret(file, save)).rejects.toThrow('private owner file')
    await chmod(file, 0o600); await symlink(file, join(directory, 'link'))
    await expect(importPrivateSecret(join(directory, 'link'), save)).rejects.toThrow()
    await expect(importPrivateSecret(directory, save)).rejects.toThrow('private owner file')
    await writeFile(file, 'x'.repeat(16385))
    await expect(importPrivateSecret(file, save)).rejects.toThrow('private owner file')
    expect(save).toHaveBeenCalledTimes(1)
  }
  finally { await rm(directory, { recursive: true, force: true }) }
})

it('refuses runtime configuration and credentials before storing their contents, including path aliases', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pods-runtime-secret-import-'))
  try {
    const file = join(directory, 'key.json'); const config = join(directory, 'agent-backends.json')
    await writeFile(file, '{"api_key":"synthetic-runtime-key"}', { mode: 0o600 })
    await writeFile(config, '{}', { mode: 0o600 })
    await symlink(file, join(directory, 'key-link'))
    await link(file, join(directory, 'key-hardlink'))
    setMandatorySecretPaths([file, config])
    const save = vi.fn(async () => ({ epoch: 2 }))
    for (const path of [file, config, join(directory, 'key-link'), join(directory, 'key-hardlink')]) {
      await expect(importPrivateSecret(path, save)).rejects.toThrow('cannot be assigned to a Pod')
    }
    expect(save).not.toHaveBeenCalled()
    setMandatorySecretPaths([])
    await expect(importPrivateSecret(join(directory, 'key-hardlink'), save)).rejects.toThrow('one link')
    expect(save).not.toHaveBeenCalled()
  }
  finally { await rm(directory, { recursive: true, force: true }) }
})
