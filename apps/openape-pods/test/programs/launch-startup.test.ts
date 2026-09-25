// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { ProgramManager } from '../../src/main/programs/manager'
import { CredentialCache } from '../../src/main/connections/cache'
import type { ConnectionManager } from '../../src/main/connections/manager'

it('tracks a preparing application so quitting can cancel it before launch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pods-launch-preparation-'))
  await mkdir(join(root, 'authentication'))
  let resume!: () => void; let connecting = false; let released = false
  const pending = new Promise<void>((resolve) => { resume = resolve })
  const podId = randomUUID(); const applicationId = randomUUID()
  const credentials = new CredentialCache(join(root, 'credentials'), { available: () => true, encrypt: value => Buffer.from(value), decrypt: value => value.toString() })
  const connections = { podConnection: async () => { connecting = true; await pending; throw new Error('Synthetic preparation interrupted') } } as unknown as ConnectionManager
  const manager = new ProgramManager(join(root, 'authentication'), '/unused', credentials, connections,
    async () => ({ epoch: 1, resources: [{ id: applicationId, podId, name: 'Fixture', kind: 'tool', state: 'ready', revision: 1, configuration: { type: 'program' } }] }),
    async (command) => { if (command.type === 'release') released = true; return command.type === 'reserveShell' ? 'Fixture' : true })
  const launch = manager.launch({ type: 'launch', podId, applicationId, epoch: 1 }, { executable: process.execPath, cli: '/unused', client: '/unused' })
  const rejected = expect(launch).rejects.toThrow('Synthetic preparation interrupted')
  try {
    await expect.poll(() => connecting).toBe(true)
    expect(manager.busy()).toBe(true)
    manager.cancelAll(); resume(); await rejected; await manager.stop()
    expect(manager.busy()).toBe(false); expect(released).toBe(true)
  }
  finally { resume(); await rejected; await manager.stop(); await rm(root, { recursive: true, force: true }) }
})
