// @vitest-environment node
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { assignedDirectories, managedRoot, setVolumeIdentityHelper } from '../../src/runtime/directories'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { runAliases } from '../../src/contracts/runs'
import { ProgramManager } from '../../src/main/programs/manager'
import type { DirectoryAssignment, PodResource } from '../../src/contracts/resources'

const roots: string[] = []; const stores: PodDatabase[] = []
afterEach(() => { vi.unstubAllEnvs(); for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const volumeA = 'AAAAAAAA-1111-2222-3333-444444444444'; const volumeB = 'BBBBBBBB-1111-2222-3333-444444444444'

/** A synthetic helper whose reported volume a test can switch, standing in for a remount or another volume. */
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'pods-volume-'))); roots.push(base)
  const volume = join(base, 'volume'); writeFileSync(volume, volumeA)
  const helper = join(base, 'helper.sh')
  writeFileSync(helper, `#!/bin/sh\n[ "$1" = volume-identity ] && [ -d "$2" ] || exit 1\nprintf '{"volume":"%s"}' "$(cat '${volume}')"\n`); chmodSync(helper, 0o755)
  setVolumeIdentityHelper(helper)
  vi.stubEnv('HOME', join(base, 'home')); mkdirSync(join(base, 'home'))
  const root = join(base, 'profile'); mkdirSync(root)
  const store = new PodDatabase(root); stores.push(store)
  const pod = store.createPod({ name: 'Directories' })
  return { base, root, store, pod, registry: new ResourceRegistry(store, vi.fn()), setVolume: (value: string) => writeFileSync(volume, value) }
}
const saved = (registry: ResourceRegistry, podId: string) => registry.list(podId).find(item => item.kind === 'directory' && item.state === 'ready')!
function withConfiguration(resource: PodResource, change: Partial<DirectoryAssignment> & { volume?: string | undefined }): PodResource {
  const configuration = { ...resource.configuration, ...change }
  if (change.volume === undefined && 'volume' in change) delete configuration.volume
  return { ...resource, configuration }
}

it('keeps a folder valid across a remount and refuses another volume, a replacement and a missing folder', async () => {
  const { base, root, pod, registry, setVolume } = fixture()
  const folder = join(base, 'exchange'); mkdirSync(folder)
  await registry.assignDirectory(pod.id, folder, 'readWrite', 0)
  const resource = saved(registry, pod.id)
  expect(resource.configuration).toMatchObject({ path: folder, volume: volumeA, inode: String(lstatSync(folder).ino) })
  // A remount gives the same volume a new device number; volume and inode decide.
  const remounted = withConfiguration(resource, { device: '1' })
  expect(await assignedDirectories(root, pod.id, [remounted])).toHaveLength(1)
  setVolume(volumeB)
  await expect(assignedDirectories(root, pod.id, [remounted])).rejects.toThrow('Assigned directory changed')
  setVolume(volumeA)
  renameSync(folder, join(base, 'original')); mkdirSync(folder)
  await expect(assignedDirectories(root, pod.id, [resource])).rejects.toThrow('Assigned directory changed')
  rmSync(folder, { recursive: true })
  await expect(assignedDirectories(root, pod.id, [resource])).rejects.toThrow()
  setVolume('not-a-uuid')
  renameSync(join(base, 'original'), folder)
  await expect(assignedDirectories(root, pod.id, [resource])).rejects.toThrow('Invalid volume identity')
})

it('passes a legacy record only on its original device and fails closed without a readable volume', async () => {
  const { base, root, pod, registry } = fixture()
  const folder = join(base, 'legacy'); mkdirSync(folder)
  await registry.assignDirectory(pod.id, folder, 'read', 0)
  const legacy = withConfiguration(saved(registry, pod.id), { volume: undefined })
  expect(await assignedDirectories(root, pod.id, [legacy])).toHaveLength(1)
  await expect(assignedDirectories(root, pod.id, [withConfiguration(legacy, { device: '1' })])).rejects.toThrow('Assigned directory changed')
  setVolumeIdentityHelper(join(base, 'missing-helper'))
  await expect(assignedDirectories(root, pod.id, [saved(registry, pod.id)])).rejects.toThrow('volume identity')
})

it('refreshes a changed identity only through reassignment, which advances the epoch, pauses the Pod and stops runs', async () => {
  const { base, store, pod, registry } = fixture()
  const stop = vi.fn(); const fenced = new ResourceRegistry(store, stop)
  const folder = join(base, 'refresh'); mkdirSync(folder)
  await fenced.assignDirectory(pod.id, folder, 'readWrite', 0)
  store.db.prepare('UPDATE pods SET lifecycle=\'active\' WHERE id=?').run(pod.id)
  await expect(fenced.assignDirectory(pod.id, folder, 'readWrite', 0)).rejects.toThrow('changed')
  await fenced.assignDirectory(pod.id, folder, 'readWrite', 1)
  expect(registry.list(pod.id).filter(item => item.kind === 'directory')).toHaveLength(1)
  expect(fenced.epoch(pod.id)).toBe(2); expect(store.getPod(pod.id).lifecycle).toBe('paused'); expect(stop).toHaveBeenCalledTimes(2)
  expect(() => fenced.assertCurrent(pod.id, 1)).toThrow('changed')
})

it('creates owner-only folders below the data root, stores the alias once and refuses the root, ancestors and unsafe names', async () => {
  const { base, pod, registry } = fixture()
  const root = managedRoot()
  expect(root).toBe(join(base, 'home', '.openape', 'pods'))
  const target = join(root, 'abgaben', 'staging')
  await registry.assignDirectory(pod.id, target, 'readWrite', 0, 'abgaben-staging')
  for (const folder of [join(base, 'home', '.openape'), root, join(root, 'abgaben'), target]) expect(lstatSync(folder).mode & 0o777).toBe(0o700)
  await registry.assignDirectory(pod.id, target, 'readWrite', 1, 'abgaben-staging')
  const directories = registry.list(pod.id).filter(item => item.kind === 'directory')
  expect(directories).toHaveLength(1)
  expect(registry.aliases(pod.id).map(item => [item.alias, item.resource.id])).toEqual([['abgaben-staging', directories[0]!.id]])
  expect(runAliases(registry.aliases(pod.id), []).directories).toEqual({ 'abgaben-staging': target })
  for (const path of [root, join(base, 'home', '.openape'), join(base, 'home')]) await expect(registry.assignDirectory(pod.id, path, 'read', 2)).rejects.toThrow()
  await expect(registry.assignDirectory(pod.id, join(root, 'Abgaben'), 'read', 2)).rejects.toThrow('lowercase')
  await expect(registry.assignDirectory(pod.id, `${root}/abgaben/../other`, 'read', 2)).rejects.toThrow('Invalid directory path')
  await expect(registry.assignDirectory(pod.id, join(root, 'valid'), 'read', 2, 'Not A Key')).rejects.toThrow('alias')
  const outside = join(base, 'outside'); mkdirSync(outside); symlinkSync(outside, join(root, 'linked'))
  await expect(registry.assignDirectory(pod.id, join(root, 'linked', 'inner'), 'read', 2)).rejects.toThrow('real folders')
  expect(registry.epoch(pod.id)).toBe(2)
})

it('refuses a changed folder in the application session path before reserving or starting anything', async () => {
  const { base, root, pod, registry, setVolume } = fixture()
  const folder = join(base, 'session'); mkdirSync(folder)
  await registry.assignDirectory(pod.id, folder, 'read', 0)
  const dispatch = vi.fn(async () => { throw new Error('reserved') })
  const manager = new ProgramManager(join(root, 'credentials'), '/unused', {} as never, {} as never, async () => ({ resources: registry.list(pod.id), epoch: registry.epoch(pod.id) }), dispatch, () => ({}) as never)
  const start = () => manager.terminal({ type: 'start', podId: pod.id, applicationId: '00000000-0000-4000-8000-000000000009', epoch: 1, argv: ['list'] })
  await expect(start()).rejects.toThrow('reserved')
  setVolume(volumeB); dispatch.mockClear()
  await expect(start()).rejects.toThrow('Assigned directory changed')
  expect(dispatch).not.toHaveBeenCalled()
})
