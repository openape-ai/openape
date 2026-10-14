// @vitest-environment node
import { mkdir, mkdtemp, writeFile, rm, symlink, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { installedProgramDefinition, programDefinition } from '../../src/main/programs/definition'
import { programIdentity, programsByPath } from '../../src/contracts/programs'
import { parseAdministration } from '../../src/contracts/codex-admin'
import { parseSandboxDeclaration } from '../../src/contracts/sandbox'
import { httpPermission, originPermission, runtimePermission, sshPermission } from '../../src/main/grants/pod-permissions'

// Issue 1473, revision 4: a program is its path, file hash and optional runtime descriptor; its command name is the
// file name it was chosen by, and the IdP receives that name with the file hash.
it('keeps the chosen command name when the symlink target differs and carries no adapter fields', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-installed-name-')))
  try {
    const executable = join(root, 'tool-version-2'); const selected = join(root, 'example-cli')
    await writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 }); await symlink(executable, selected)
    const definition = await programDefinition(selected)
    expect(definition).toEqual({ name: 'example-cli', cliId: 'example-cli', executable, executableHash: createHash('sha256').update('#!/bin/sh\nexit 0\n').digest('hex'), entryFiles: [], environment: {}, networkHosts: [] })
    expect(programIdentity(definition)).toEqual({ name: 'example-cli', sha256: definition.executableHash })
    await expect(programDefinition(join(root, 'missing'))).rejects.toThrow()
    await writeFile(join(root, 'bad name'), '#!/bin/sh\n', { mode: 0o700 })
    await expect(programDefinition(join(root, 'bad name'))).rejects.toThrow('letters, digits, underscores or hyphens')
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

describe('assignment by path (issue 1473, revision 4)', () => {
  async function folders() {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-path-definition-')))
    const executable = join(root, 'bin', 'fixture-cli'); await mkdir(join(root, 'bin'))
    await writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
    return { root, executable, options: { protectedRoots: [join(root, 'profile'), join(root, 'writable')] } }
  }

  it('refuses executables in folders Pods can write, also through a link', async () => {
    const f = await folders()
    try {
      expect((await installedProgramDefinition(f.executable, f.options)).cliId).toBe('fixture-cli')
      for (const folder of ['profile', 'writable']) {
        const inside = join(f.root, folder, 'fixture-cli'); await mkdir(join(f.root, folder))
        await writeFile(inside, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
        await expect(installedProgramDefinition(inside, f.options)).rejects.toThrow('Assign an installed executable outside the Pods profile, Pod folders and folders Pods can write')
        const link = join(f.root, `link-${folder}`); await mkdir(link); await symlink(inside, join(link, 'fixture-cli'))
        await expect(installedProgramDefinition(join(link, 'fixture-cli'), f.options)).rejects.toThrow('outside the Pods profile')
      }
    }
    finally { await rm(f.root, { recursive: true, force: true }) }
  })

  it('refuses runtime read directories inside or around folders Pods can write', async () => {
    const f = await folders()
    try {
      const interpreter = join(f.root, 'tools', 'interpreter'); await mkdir(join(f.root, 'tools')); await writeFile(interpreter, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
      await mkdir(join(f.root, 'profile')); await mkdir(join(f.root, 'writable', 'lib'), { recursive: true })
      const runtime = join(f.root, 'tools', 'runtime.json')
      for (const readDirectories of [[join(f.root, 'writable', 'lib')], [f.root]]) {
        await writeFile(runtime, JSON.stringify({ version: 1, executable: interpreter, arguments: [], readDirectories, environment: {} }), { mode: 0o600 })
        await expect(installedProgramDefinition(f.executable, { ...f.options, runtimePath: runtime })).rejects.toThrow('Assign an installed executable outside the Pods profile, Pod folders and folders Pods can write')
      }
      await writeFile(runtime, JSON.stringify({ version: 1, executable: interpreter, arguments: [], readDirectories: [join(f.root, 'tools')], environment: {} }), { mode: 0o600 })
      expect((await installedProgramDefinition(f.executable, { ...f.options, runtimePath: runtime })).runtime?.readDirectories).toEqual([join(f.root, 'tools')])
    }
    finally { await rm(f.root, { recursive: true, force: true }) }
  })

  it('refuses adapter paths and command names at the MCP boundary', () => {
    const add = { action: 'program', revision: 1, command: { type: 'add', podId: '00000000-0000-4000-8000-000000000001', epoch: 0 }, path: '/opt/homebrew/bin/gh' }
    expect(parseAdministration(add)).toMatchObject({ kind: 'program', path: '/opt/homebrew/bin/gh' })
    for (const extra of [{ adapterPath: '/tmp/local.toml' }, { commandName: 'gh' }]) {
      expect(() => parseAdministration({ ...add, ...extra })).toThrow(programsByPath)
      expect(() => parseSandboxDeclaration({ programs: [{ path: '/opt/homebrew/bin/gh', ...extra }] })).toThrow(programsByPath)
    }
    expect(parseSandboxDeclaration({ programs: [{ path: '/opt/homebrew/bin/gh', runtimePath: '/tmp/runtime.json' }] })).toEqual({ programs: [{ path: '/opt/homebrew/bin/gh', runtimePath: '/tmp/runtime.json' }] })
  })

  // Grants approved before the switch keep matching: the desktop builds exactly the permission strings the shapes-registry
  // entries pod-runtime, pod-http and pod-ssh resolved to (recorded with the registry copies removed by this change).
  it('builds the desktop-own permissions without an adapter, equal to the registry permissions', () => {
    const pod = '11111111-1111-4111-8111-111111111111'
    expect(runtimePermission({ podId: pod, name: 'My Pod', script: 'run.mjs', workspace: 'workspace' }).detail).toEqual({ type: 'openape_cli', cli_id: 'pod-runtime', operation_id: 'run', resource_chain: [{ resource: 'pod', selector: { id: pod } }], action: 'run', permission: `pod-runtime.pod[id=${pod}]#run`, display: 'Run the stored script of My Pod', risk: 'high' })
    expect(httpPermission('https://api.example.com', 'GET').detail).toEqual({ type: 'openape_cli', cli_id: 'pod-http', operation_id: 'request', resource_chain: [{ resource: 'https-origin', selector: { url: 'https://api.example.com' } }, { resource: 'http-method', selector: { name: 'GET' } }], action: 'request', permission: 'pod-http.https-origin[url=https://api.example.com].http-method[name=GET]#request', display: 'HTTP GET to https://api.example.com', risk: 'high' })
    expect(originPermission('https://api.example.com').detail.permission).toBe('pod-http.https-origin[url=https://api.example.com]#request')
    expect(sshPermission(['pod-ssh', 'inventory', '--binding', 'abc', '--profile', 'linux-v1']).detail).toEqual({ type: 'openape_cli', cli_id: 'pod-ssh', operation_id: 'inventory', resource_chain: [{ resource: 'ssh-binding', selector: { hash: 'abc' } }, { resource: 'inventory-profile', selector: { name: 'linux-v1' } }], action: 'read', permission: 'pod-ssh.ssh-binding[hash=abc].inventory-profile[name=linux-v1]#read', display: 'Read fixed SSH inventory linux-v1 for reviewed binding abc', risk: 'low' })
    expect(() => sshPermission(['pod-ssh', 'inventory', '--binding', 'abc'])).toThrow('Invalid SSH inventory permission')
  })
})
