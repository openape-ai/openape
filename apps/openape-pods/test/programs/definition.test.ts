// @vitest-environment node
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { loadPodAdapter } from '../../src/main/grants/registry-copies'
import { loadAdapter, resolveCommand } from '@openape/apes'
import type { RegistryIndex } from '@openape/apes'
import { programDefinition, registryProgramDefinition } from '../../src/main/programs/definition'
import { adapterStanding, registryAdaptersOnly } from '../../src/contracts/programs'
import { parseAdministration } from '../../src/contracts/codex-admin'
import { parseSandboxDeclaration } from '../../src/contracts/sandbox'
import { programSpec } from '../../src/main/grants/pod-grants'

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

describe('shapes-registry assignment (issue 1473)', () => {
  const adapter = 'schema="openape-shapes/v1"\n[cli]\nid="fixture"\nexecutable="fixture-cli"\naudience="shapes"\ntested_versions=["2.1"]\nversion_command=["--version"]\nversion_pattern=\'^fixture (\\d+\\.\\d+)\'\n[[operation]]\nid="read"\ncommand=["read"]\ndisplay="Read fixture"\naction="read"\nrisk="low"\nresource_chain=["fixture:*"]\n'
  async function registry(output: string | null = 'fixture 2.1.4\n', content = adapter, name = 'fixture-cli') {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-registry-definition-')))
    const adapters = join(root, 'adapters'); await mkdir(adapters)
    await writeFile(join(adapters, 'fixture.toml'), content)
    const executable = join(root, name)
    await writeFile(executable, '#!/bin/sh\necho NEVER_EXECUTED_BY_THE_TEST\n', { mode: 0o700 })
    const digest = createHash('sha256').update(content).digest('hex')
    const index: RegistryIndex = { version: 1, generated_at: '2026-10-14T00:00:00Z', adapters: [{ id: 'fixture', name: 'Fixture', description: '', category: 'other', tags: [], author: 'test', executable: 'fixture-cli', min_shapes_version: '0.1.0', digest: `SHA-256:${digest}`, download_url: 'https://example.invalid/fixture.toml' }] }
    const probe = vi.fn(async () => output)
    return { root, adapters, executable, digest, probe, options: { store: join(root, 'store'), adapters, registry: async () => index, protectedRoots: [join(root, 'profile'), join(root, 'writable')], probe } }
  }

  it('assigns the verified registry adapter as a copy named by its digest and binds the probed, tested CLI version', async () => {
    const f = await registry()
    try {
      const definition = await registryProgramDefinition(f.executable, f.options)
      expect(definition).toMatchObject({ cliId: 'fixture-cli', registry: { id: 'fixture', digest: `SHA-256:${f.digest}` }, cliVersion: { version: '2.1', tested: true }, adapterPath: join(f.root, 'store', `fixture-${f.digest}.toml`), adapterHash: f.digest })
      expect(f.probe).toHaveBeenCalledWith(expect.objectContaining({ executable: f.executable }), ['--version'])
      expect(adapterStanding(definition)).toEqual({ exact: false })
      // A later adapter update leaves the assignment unchanged until the owner replaces it.
      await writeFile(join(f.adapters, 'fixture.toml'), `${adapter}# changed\n`)
      expect(await readFile(definition.adapterPath, 'utf8')).toBe(adapter)
      await expect(registryProgramDefinition(f.executable, f.options)).rejects.toThrow('The installed adapter fixture differs from the shapes registry; run apes adapter install fixture --refresh')
    }
    finally { await rm(f.root, { recursive: true, force: true }) }
  })

  it('falls back to exact approvals for untested or unreadable CLI versions', async () => {
    const untested = await registry('fixture 2.2.0\n'); const silent = await registry(null)
    try {
      const definition = await registryProgramDefinition(untested.executable, untested.options)
      expect(definition.cliVersion).toEqual({ version: '2.2', tested: false })
      expect(adapterStanding(definition)).toEqual({ exact: true, reason: 'versionUntested' })
      expect(adapterStanding(await registryProgramDefinition(silent.executable, silent.options))).toEqual({ exact: true, reason: 'versionUnknown' })
      expect(adapterStanding({ registry: undefined, cliVersion: undefined })).toEqual({ exact: true, reason: 'notFromRegistry' })
      await expect(programSpec(definition)).rejects.toThrow('fixture-cli needs an exact approval for every command (versionUntested); grant single commands')
      expect((await programSpec(definition, ['read'])).details[0]!.constraints).toEqual({ exact_command: true })
    }
    finally { await Promise.all([untested, silent].map(f => rm(f.root, { recursive: true, force: true }))) }
  })

  it('binds a script by its tested digest without running it, but never a chosen command name to another file', async () => {
    const script = '#!/bin/sh\necho NEVER_EXECUTED_BY_THE_TEST\n'
    const pinned = adapter.replace('version_pattern', `tested_digests=["SHA-256:${createHash('sha256').update(script).digest('hex')}"]\nversion_pattern`)
    const f = await registry('fixture 2.1.4\n', pinned, 'fixture-tool.mjs')
    try {
      const definition = await registryProgramDefinition(f.executable, { ...f.options, commandName: 'fixture-cli' })
      expect(definition).toMatchObject({ name: 'fixture-cli', cliId: 'fixture-cli', cliVersion: { version: expect.stringMatching(/^sha256:[a-f0-9]{12}$/), tested: true } })
      expect(f.probe).not.toHaveBeenCalled()
      await writeFile(f.executable, '#!/bin/sh\nrm -rf "$1"\n', { mode: 0o700 })
      await expect(registryProgramDefinition(f.executable, { ...f.options, commandName: 'fixture-cli' })).rejects.toThrow('The registry adapter fixture is for fixture-cli; fixture-tool.mjs is neither that executable nor a file it was tested with')
      expect(f.probe).not.toHaveBeenCalled()
    }
    finally { await rm(f.root, { recursive: true, force: true }) }
  })

  it('refuses executables in folders Pods can write before probing them', async () => {
    const f = await registry()
    try {
      for (const folder of ['profile', 'writable']) {
        const inside = join(f.root, folder, 'fixture-cli'); await mkdir(join(f.root, folder))
        await writeFile(inside, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
        await expect(registryProgramDefinition(inside, f.options)).rejects.toThrow('Assign an installed executable outside the Pods profile, Pod folders and folders Pods can write')
        // A link from elsewhere into a protected folder resolves to it and is refused as well.
        const link = join(f.root, `link-${folder}`); await mkdir(link); await symlink(inside, join(link, 'fixture-cli'))
        await expect(registryProgramDefinition(join(link, 'fixture-cli'), f.options)).rejects.toThrow('outside the Pods profile')
      }
      expect(f.probe).not.toHaveBeenCalled()
    }
    finally { await rm(f.root, { recursive: true, force: true }) }
  })

  it('refuses runtime read directories inside or around folders Pods can write', async () => {
    const f = await registry()
    try {
      const interpreter = join(f.root, 'tools', 'interpreter'); await mkdir(join(f.root, 'tools')); await writeFile(interpreter, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
      await mkdir(join(f.root, 'profile')); await mkdir(join(f.root, 'writable', 'lib'), { recursive: true })
      const runtime = join(f.root, 'tools', 'runtime.json')
      for (const readDirectories of [[join(f.root, 'writable', 'lib')], [f.root]]) {
        await writeFile(runtime, JSON.stringify({ version: 1, executable: interpreter, arguments: [], readDirectories, environment: {} }), { mode: 0o600 })
        await expect(registryProgramDefinition(f.executable, { ...f.options, runtimePath: runtime })).rejects.toThrow('Assign an installed executable outside the Pods profile, Pod folders and folders Pods can write')
      }
      await writeFile(runtime, JSON.stringify({ version: 1, executable: interpreter, arguments: [], readDirectories: [join(f.root, 'tools')], environment: {} }), { mode: 0o600 })
      expect((await registryProgramDefinition(f.executable, { ...f.options, runtimePath: runtime })).runtime?.readDirectories).toEqual([join(f.root, 'tools')])
      expect(f.probe).toHaveBeenCalledTimes(1)
    }
    finally { await rm(f.root, { recursive: true, force: true }) }
  })

  it('refuses CLIs without an installed registry adapter and adapter paths at the MCP boundary', async () => {
    const f = await registry()
    try {
      await expect(registryProgramDefinition(f.executable, { ...f.options, commandName: 'other-cli' })).rejects.toThrow('The shapes registry has no adapter for other-cli; only registry adapters are accepted')
      await rm(join(f.adapters, 'fixture.toml'))
      await expect(registryProgramDefinition(f.executable, f.options)).rejects.toThrow('The registry adapter fixture is not installed; run apes adapter install fixture')
      const add = { action: 'program', revision: 1, command: { type: 'add', podId: '00000000-0000-4000-8000-000000000001', epoch: 0 }, path: f.executable }
      expect(() => parseAdministration({ ...add, adapterPath: join(f.root, 'local.toml') })).toThrow(registryAdaptersOnly)
      expect(parseAdministration(add)).not.toHaveProperty('adapterPath')
      expect(() => parseSandboxDeclaration({ programs: [{ path: f.executable, adapterPath: join(f.root, 'local.toml') }] })).toThrow(registryAdaptersOnly)
    }
    finally { await rm(f.root, { recursive: true, force: true }) }
  })

  it('loads Pods\' own adapters only as their pinned registry copies', async () => {
    for (const cliId of ['pod-runtime', 'pod-http', 'pod-ssh'] as const) expect(loadPodAdapter(cliId, resolve(`runtime-sources/${cliId}-shapes.toml`)).adapter.cli.id).toBe(cliId)
    const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-registry-copy-')))
    try {
      const changed = join(root, 'pod-http-shapes.toml')
      await writeFile(changed, (await readFile(resolve('runtime-sources/pod-http-shapes.toml'), 'utf8')).replace('# OpenApe Pods HTTP authority', '# Changed copy'))
      expect(() => loadPodAdapter('pod-http', changed)).toThrow('pod-http differs from its shapes-registry entry; reinstall OpenApe Pods')
    }
    finally { await rm(root, { recursive: true, force: true }) }
  })
})
