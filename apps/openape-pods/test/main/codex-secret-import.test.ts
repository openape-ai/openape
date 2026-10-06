// @vitest-environment node
import { mkdtemp, writeFile, chmod, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { importPrivateSecret } from '../../src/main/codex/secret-import'

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
