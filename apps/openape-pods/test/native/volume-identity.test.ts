// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { inspectDirectory, setVolumeIdentityHelper } from '../../src/runtime/directories'

// Attaches real APFS disk images, so it runs only when requested: PODS_NATIVE_VOLUME_TEST=1 npx vitest run test/native
const roots: string[] = []; const mounts: string[] = []
afterEach(() => {
  for (const mount of mounts.splice(0)) execFileSync('/usr/bin/hdiutil', ['detach', mount, '-quiet'])
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function attach(image: string, base: string) {
  const output = execFileSync('/usr/bin/hdiutil', ['attach', image, '-nobrowse', '-mountrandom', base], { encoding: 'utf8' })
  const mount = output.trim().split('\n').at(-1)!.split('\t').at(-1)!.trim(); mounts.push(mount); return mount
}
function detach(mount: string) { execFileSync('/usr/bin/hdiutil', ['detach', mount, '-quiet']); mounts.splice(mounts.indexOf(mount), 1) }

it.runIf(process.platform === 'darwin' && process.env.PODS_NATIVE_VOLUME_TEST === '1')('keeps the volume identity of a real APFS folder across a remount that changes st_dev, and tells another volume apart', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'pods-native-volume-'))); roots.push(base)
  const helper = join(base, 'pods-helper')
  execFileSync('/usr/bin/xcrun', ['clang', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', join(__dirname, '../../native/pods-helper.c'), '-o', helper])
  setVolumeIdentityHelper(helper)
  const profile = join(base, 'profile'); mkdirSync(profile)
  for (const name of ['a', 'b']) execFileSync('/usr/bin/hdiutil', ['create', '-size', '20m', '-fs', 'APFS', '-volname', `PodsVolume${name}`, join(base, `${name}.dmg`), '-quiet'])
  const first = attach(join(base, 'a.dmg'), base); mkdirSync(join(first, 'staging'))
  const before = await inspectDirectory(profile, join(first, 'staging'), 'read')
  detach(first)
  const other = attach(join(base, 'b.dmg'), base); mkdirSync(join(other, 'staging'))
  const second = attach(join(base, 'a.dmg'), base)
  const after = await inspectDirectory(profile, join(second, 'staging'), 'read')
  const foreign = await inspectDirectory(profile, join(other, 'staging'), 'read')
  expect(before.volume).toMatch(/^[0-9A-F-]{36}$/)
  expect(after.device).not.toBe(before.device)
  expect([after.volume, after.inode]).toEqual([before.volume, before.inode])
  expect(foreign.inode).toBe(before.inode)
  expect(foreign.volume).not.toBe(before.volume)
}, 60000)
