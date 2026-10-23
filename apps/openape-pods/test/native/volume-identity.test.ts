// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { assignedDirectories, setVolumeIdentityHelper } from '../../src/runtime/directories'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'

// Attaches real APFS disk images, so it runs only when requested: PODS_NATIVE_VOLUME_TEST=1 npx vitest run test/native
const roots: string[] = []; const mounts: string[] = []; const stores: PodDatabase[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const mount of mounts.splice(0)) execFileSync('/usr/bin/hdiutil', ['detach', mount, '-quiet'])
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function attach(image: string, mountpoint: string): string {
  execFileSync('/usr/bin/hdiutil', ['attach', image, '-nobrowse', '-mountpoint', mountpoint, '-quiet']); mounts.push(mountpoint); return mountpoint
}
function detach(mountpoint: string): void { execFileSync('/usr/bin/hdiutil', ['detach', mountpoint, '-quiet']); mounts.splice(mounts.indexOf(mountpoint), 1) }

it.runIf(process.platform === 'darwin' && process.env.PODS_NATIVE_VOLUME_TEST === '1')('accepts a real assignment after its volume is remounted with a new device number and refuses another volume at the same path', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'pods-native-volume-'))); roots.push(base)
  const helper = join(base, 'pods-helper')
  execFileSync('/usr/bin/xcrun', ['clang', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', join(__dirname, '../../native/pods-helper.c'), '-o', helper])
  setVolumeIdentityHelper(helper)
  for (const name of ['a', 'b']) execFileSync('/usr/bin/hdiutil', ['create', '-size', '20m', '-fs', 'APFS', '-volname', `PodsVolume${name}`, join(base, `${name}.dmg`), '-quiet'])
  const stable = join(base, 'stable'); const spare = join(base, 'spare'); mkdirSync(stable); mkdirSync(spare)
  // Both fresh volumes get the same inode for their first folder, so only the volume UUID tells them apart.
  attach(join(base, 'b.dmg'), spare); mkdirSync(join(spare, 'staging')); detach(spare)
  attach(join(base, 'a.dmg'), stable); mkdirSync(join(stable, 'staging'))
  const store = new PodDatabase(join(base, 'profile')); stores.push(store)
  const registry = new ResourceRegistry(store, vi.fn()); const pod = store.createPod({ name: 'Native volume' })
  await registry.assignDirectory(pod.id, join(stable, 'staging'), 'readWrite', 0)
  const saved = registry.list(pod.id)[0]!.configuration
  expect(saved.volume).toMatch(/^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/)
  detach(stable)
  attach(join(base, 'b.dmg'), spare)
  attach(join(base, 'a.dmg'), stable)
  const [remounted] = await assignedDirectories(store.root, pod.id, registry.list(pod.id))
  expect(remounted!.device).not.toBe(saved.device)
  expect([remounted!.volume, remounted!.inode]).toEqual([saved.volume, saved.inode])
  detach(stable); detach(spare)
  attach(join(base, 'b.dmg'), stable)
  await expect(assignedDirectories(store.root, pod.id, registry.list(pod.id))).rejects.toThrow('Assigned directory changed')
}, 120000)
