// @vitest-environment node
import { mkdtemp, writeFile, rm, symlink, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { loadAdapter, resolveCommand } from '@openape/apes'
import { programDefinition } from '../../src/main/programs/definition'

it('keeps the installed command name when the adapter ID and symlink target differ', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-installed-name-')))
  try {
    const executable = join(root, 'tool-version-2'); const selected = join(root, 'example-cli'); const adapter = join(root, 'example.toml')
    await writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 }); await symlink(executable, selected)
    await writeFile(adapter, 'schema="openape-shapes/v1"\n[cli]\nid="example"\nexecutable="example-cli"\naudience="shapes"\n[[operation]]\nid="read"\ncommand=["read"]\ndisplay="Read fixture"\naction="read"\nrisk="low"\nresource_chain=["fixture:*"]\n')
    const definition = await programDefinition(selected, adapter)
    expect(definition.name).toBe('example-cli'); expect(definition.cliId).toBe('example-cli')
    expect(definition.executable).toBe(executable)
    expect((await resolveCommand(loadAdapter(definition.cliId, definition.adapterPath), [definition.cliId, 'read'])).detail.cli_id).toBe('example')
  }
  finally { await rm(root, { recursive: true, force: true }) }
})
