// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm, symlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { CredentialCache } from '../../src/main/connections/cache'
import type { ConnectionManager } from '../../src/main/connections/manager'
import { ProgramManager } from '../../src/main/programs/manager'
import { ProgramState } from '../../src/main/programs/state'
import { ProgramControl } from '../../src/worker/resources/programs'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { PodDatabase } from '../../src/worker/storage/database'

it('imports a selected application file without changing its source or exposing it as a reference or script secret', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pods-program-import-')); const store = new PodDatabase(join(root, 'profile'))
  const resources = new ResourceRegistry(store, () => {}); const control = new ProgramControl(store, resources)
  const credentials = new CredentialCache(join(root, 'credentials'), { available: () => true, encrypt: value => Buffer.from(value), decrypt: value => value.toString() })
  const pod = store.createPod({ name: 'Import fixture' })
  const manager = new ProgramManager(root, '/unused-helper', credentials, {} as ConnectionManager, async podId => ({ resources: resources.list(podId), epoch: resources.epoch(podId) }), async command => control.execute(command))
  try {
    await manager.add(pod.id, 0, { name: 'Synthetic CLI', executable: '/fixture', executableHash: 'a'.repeat(64), cliId: 'fixture', adapterPath: '/fixture.toml', adapterHash: 'b'.repeat(64), networkHosts: [], entryFiles: [], environment: {} })
    const resource = resources.list(pod.id)[0]!
    await mkdir(join(root, 'source')); const source = join(root, 'source/token.json'); const value = '{"token":"SYNTHETIC_IMPORT"}'
    await writeFile(source, value)
    await manager.importFile(pod.id, resource.id, 1, source)
    expect(await readFile(source, 'utf8')).toBe(value)
    const stateId = resource.configuration.stateId as string
    await new ProgramState(credentials).use(stateId, { podId: pod.id, applicationId: resource.id }, async directory => expect(await readFile(join(directory, 'token.json'), 'utf8')).toBe(value))
    expect(resources.list(pod.id).map(item => item.kind)).toEqual(['tool'])
    await expect(credentials.readScriptSecret(stateId, pod.id, 'token')).rejects.toThrow('not a script credential')
    await expect(manager.importFile(randomUUID(), resource.id, 1, source)).rejects.toThrow()
    await symlink(source, join(root, 'linked'))
    await expect(manager.importFile(pod.id, resource.id, 1, join(root, 'linked'))).rejects.toThrow()
    expect(store.db.prepare('SELECT count(*) AS count FROM program_leases').get()?.count).toBe(0)
    await manager.replace(pod.id, resource.id, resources.epoch(pod.id), { name: 'Installed CLI', executable: '/installed/tool', executableHash: 'c'.repeat(64), cliId: 'tool', adapterPath: '/installed/tool.toml', adapterHash: 'd'.repeat(64), networkHosts: [], entryFiles: [], environment: {} })
    const replaced = resources.list(pod.id)[0]!
    expect(replaced.id).toBe(resource.id)
    expect(replaced.configuration.stateId).toBe(stateId)
    expect(replaced.configuration.capability).toBe(resource.configuration.capability)
    expect(replaced.configuration.grants).toEqual([])
    await new ProgramState(credentials).use(stateId, { podId: pod.id, applicationId: resource.id }, async directory => expect(await readFile(join(directory, 'token.json'), 'utf8')).toBe(value))
    await expect(manager.replace(pod.id, resource.id, 1, {} as never)).rejects.toThrow('changed')
  }
  finally { store.close(); await rm(root, { recursive: true, force: true }) }
})
