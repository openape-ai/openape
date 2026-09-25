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

it('assigns an explicit interpreter without sharing the owner HOME or changing native programs', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-runtime-definition-')))
  try {
    const runtime = join(root, 'runtime.json')
    const executable = join(root, 'interpreter')
    await writeFile(executable, 'SYNTHETIC_EXECUTABLE', { mode: 0o700 })
    const { loadProgramRuntime, programLaunch, verifyProgramRuntime } = await import('../../src/main/programs/runtime')
    const descriptor = { version: 1, executable, arguments: ['--isolated', '-m', 'fixture'], readDirectories: [root], environment: { FIXTURE_MODE: 'read' } }
    await writeFile(runtime, JSON.stringify(descriptor), { mode: 0o600 })
    const loaded = await loadProgramRuntime(runtime)
    const definition = { executable: '/launcher', executableHash: 'original', environment: {}, runtime: loaded } as import('../../src/contracts/programs').ProgramDefinition
    expect(programLaunch(definition)).toMatchObject({ executable, prefix: descriptor.arguments, runtimeDirectories: [root], environment: descriptor.environment })
    await verifyProgramRuntime(definition)
    await writeFile(executable, 'CHANGED_EXECUTABLE')
    await expect(verifyProgramRuntime(definition)).rejects.toThrow()
    for (const environment of [{ HOME: '/owner' }, { HTTPS_PROXY: 'https://unexpected.test' }, { ACCESS_TOKEN: 'not-allowed' }]) {
      await writeFile(runtime, JSON.stringify({ ...descriptor, environment }))
      await expect(loadProgramRuntime(runtime)).rejects.toThrow('non-secret')
    }
    await writeFile(runtime, JSON.stringify({ ...descriptor, readDirectories: ['/'] }))
    await expect(loadProgramRuntime(runtime)).rejects.toThrow('specific runtime')
    const linked = join(root, 'linked.json'); await symlink(runtime, linked)
    await expect(loadProgramRuntime(linked)).rejects.toThrow()
  }
  finally { await rm(root, { recursive: true, force: true }) }
})
