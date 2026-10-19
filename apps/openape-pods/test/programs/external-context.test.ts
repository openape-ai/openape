// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ExternalShell } from '../../src/main/shell/session'
import { podEnvironment } from '../../src/runtime/environment'
import type { ProgramClientConfiguration } from '../../src/runtime/program-client'
import { CredentialCache } from '../../src/main/connections/cache'
import type { ConnectionManager } from '../../src/main/connections/manager'
import type { ResourceState } from '../../src/contracts/resources'
import type { SandboxLevel } from '../../src/contracts/sandbox'
import { ProgramState } from '../../src/main/programs/state'

it('refuses a redirected .openape folder in the pod HOME and cleans up a refused setup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pods-shell-path-')); const podId = randomUUID()
  try {
    const runtime = { executable: process.execPath, cli: '/fixture/cli', client: '/fixture/client' }
    const context = await podEnvironment(root, podId, runtime)
    const reference = join(root, 'untouched'); await mkdir(reference); await writeFile(join(reference, 'marker'), 'unchanged')
    await symlink(reference, join(context.home, '.openape'))
    const resources: ResourceState = { epoch: 0, resources: [] }
    const credentials = new CredentialCache(join(root, 'credentials'))
    const connections = { podConnection: async () => ({ issuer: 'https://unused.example.test', subject: 'fixture@example.test', accessToken: async () => 'synthetic' }) } as unknown as ConnectionManager
    let released = false
    const session = new ExternalShell(podId, root, runtime, resources, credentials, connections, async () => {}, async () => { released = true }, 'isolated')
    try { await expect(session.ready).rejects.toThrow('symbolic') }
    finally { session.close(); await session.completed }
    expect(released).toBe(true)
    expect(await readdir(reference)).toEqual(['marker']); expect(await readFile(join(reference, 'marker'), 'utf8')).toBe('unchanged')
    expect(await readdir(join(root, 'credentials/temporary'))).toEqual([])
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

// Owner decision October 13, 2026 (issue 1468): at the owner level a login made in the Pod terminal must be the one the
// Pod's programs use, so the terminal's application wrappers get the owner's HOME there as well.
async function wrapper(level: SandboxLevel): Promise<{ text: string, podHome: string, configuration: ProgramClientConfiguration }> {
  const root = await mkdtemp(join(tmpdir(), 'pods-shell-home-')); const podId = randomUUID(); const applicationId = randomUUID()
  try {
    const runtime = { executable: process.execPath, cli: '/fixture/cli', client: '/fixture/client' }
    const credentials = new CredentialCache(join(root, 'credentials'))
    const connections = { podConnection: async () => ({ issuer: 'https://unused.example.test', subject: 'fixture@example.test', accessToken: async () => 'synthetic' }) } as unknown as ConnectionManager
    const executable = join(root, 'az'); await writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
    const digest = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex')
    const stateId = await new ProgramState(credentials).create({ podId, applicationId })
    const configuration = { type: 'program', name: 'az', cliId: 'az', executable, executableHash: await digest(executable), stateId, capability: 'tool.az.invoke', networkHosts: [], entryFiles: [], environment: {} }
    const resources = { epoch: 1, resources: [{ id: applicationId, podId, revision: 1, kind: 'tool', state: 'ready', name: 'az', configuration }] } as unknown as ResourceState
    const session = new ExternalShell(podId, root, runtime, resources, credentials, connections, async () => {}, async () => {}, level)
    try {
      const launcher = await session.ready
      const context = await podEnvironment(root, podId, runtime)
      return { text: await readFile(join(context.bin, 'az'), 'utf8'), podHome: context.home, configuration: JSON.parse(await readFile(join(launcher, '..', `application-${applicationId}.json`), 'utf8')) }
    }
    finally { session.close(); await session.completed }
  }
  finally { await rm(root, { recursive: true, force: true }) }
}

it('gives Pod terminal applications the owner HOME at the owner level and their private state when isolated', async () => {
  const owner = await wrapper('owner')
  expect(owner.configuration.environment.HOME).toBe(homedir())
  expect(owner.configuration.environment.TMPDIR).toBe(join(owner.podHome, 'tmp'))
  const isolated = await wrapper('isolated')
  expect(isolated.configuration.environment.HOME).not.toBe(homedir())
  expect(isolated.configuration.environment.HOME).toMatch(/\/credentials\/temporary\/[^/]*\/application$/)
  for (const result of [owner, isolated]) {
    expect(result.text).toContain('program-client.mjs')
    expect(result.configuration.policy.executable).toMatch(/\/az$/)
    expect(result.configuration.launch.executableHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.configuration.launch.runtime.environment.APES_AUTH_FILE).toBeTruthy()
    expect(result.configuration.policy.readFiles).toContain(result.configuration.environment.APES_AUTH_FILE)
  }
})
