// @vitest-environment node
import { chmod, mkdir, mkdtemp, readFile, realpath, rename, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { parsePackages } from '../../src/contracts/dependencies'
import { checkLock, packageDigest, packageFiles } from '../../src/worker/dependencies/tree'
import { DependencyStore, removePackageTree } from '../../src/worker/dependencies/store'
import { PodDatabase, schemaVersion } from '../../src/worker/storage/database'
import { createBackup, restoreBackup } from '../../src/worker/data/backup'
import { DataRetention } from '../../src/worker/data/retention'

const roots: string[] = []; const stores: PodDatabase[] = []
afterEach(async () => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) await removePackageTree(root) })
const manifest = { dependencies: { 'sample-package': '1.0.0' } }
function lock() { return { lockfileVersion: 3, packages: { '': manifest, 'node_modules/sample-package': { version: '1.0.0', resolved: 'https://registry.npmjs.org/sample-package/-/sample-package-1.0.0.tgz', integrity: 'sha512-YQ==' } } } }
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-packages-'))); roots.push(root)
  const store = new PodDatabase(join(root, 'profile')); stores.push(store)
  const pod = store.createPod({ name: 'Library fixture' }); const stage = join(root, 'packages')
  await mkdir(join(stage, 'node_modules/sample-package'), { recursive: true })
  await writeFile(join(stage, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(stage, 'package-lock.json'), JSON.stringify(lock()))
  await writeFile(join(stage, 'node_modules/sample-package/package.json'), JSON.stringify({ name: 'sample-package', version: '1.0.0' }))
  await writeFile(join(stage, 'node_modules/sample-package/index.js'), 'module.exports = 42')
  return { root, store, pod, stage }
}
async function prepare(f: Awaited<ReturnType<typeof fixture>>) {
  const files = await packageFiles(f.stage, true); const hash = packageDigest(files)
  const parent = join(f.store.root, 'dependencies', f.pod.id); await mkdir(parent, { recursive: true })
  const path = join(parent, hash); await chmod(f.stage, 0o700); await rename(f.stage, path); await chmod(path, 0o500)
  f.store.db.prepare('INSERT INTO dependency_sets VALUES(?,?,?,?,?)').run(f.pod.id, hash, JSON.stringify(manifest), JSON.stringify(lock()), JSON.stringify(files))
  return { hash, path, dependencies: new DependencyStore(f.store) }
}
it('accepts only exact public package declarations and rejects hooks, ranges and external sources', () => {
  expect(parsePackages({})).toEqual({ dependencies: {} }); expect(parsePackages(manifest)).toEqual(manifest)
  for (const value of [{ scripts: { install: 'anything' } }, { dependencies: { package: '^1.0.0' } }, { dependencies: { package: 'file:/tmp' } }, { dependencies: { '../../outside': '1.0.0' } }]) expect(() => parsePackages(value)).toThrow()
  checkLock(lock(), manifest)
  for (const change of [{ resolved: 'https://example.org/package.tgz' }, { hasInstallScript: true }, { link: true }, { resolved: 'file:/tmp' }]) {
    const value = lock(); Object.assign(value.packages['node_modules/sample-package'], change)
    expect(() => checkLock(value, manifest)).toThrow()
  }
})
it('detects changed prepared contents before reuse, preserving other pods’ isolation', async () => {
  const f = await fixture(); const set = await prepare(f)
  expect(await set.dependencies.verify(f.pod.id, set.hash)).toBe(set.path)
  expect(set.dependencies.prepared(f.pod.id, manifest)).toBe(set.hash)
  const other = f.store.createPod({ name: 'Other' })
  await expect(set.dependencies.verify(other.id, set.hash)).rejects.toThrow('missing')
  const file = join(set.path, 'node_modules/sample-package/index.js'); await chmod(file, 0o600); await writeFile(file, 'module.exports = 43')
  await expect(set.dependencies.verify(f.pod.id, set.hash)).rejects.toThrow('changed')
})
it('rejects linked, native and lifecycle-dependent package contents', async () => {
  const f = await fixture(); const directory = join(f.stage, 'node_modules/sample-package')
  await writeFile(join(directory, 'package.json'), JSON.stringify({ scripts: { postinstall: 'never execute' } }))
  await expect(packageFiles(f.stage)).rejects.toThrow('installation scripts')
  await writeFile(join(directory, 'package.json'), '{}'); await writeFile(join(directory, 'addon.node'), 'fixture')
  await expect(packageFiles(f.stage)).rejects.toThrow('pure JavaScript')
  await removePackageTree(join(directory, 'addon.node')); await symlink(join(f.stage, 'package.json'), join(directory, 'linked'))
  await expect(packageFiles(f.stage)).rejects.toThrow('link')
})
it('backs up exact packages, restores them read-only and includes their bytes and deletion', async () => {
  const f = await fixture(); const set = await prepare(f)
  const backup = await createBackup(f.store, f.root)
  const target = await restoreBackup(backup, f.root, schemaVersion)
  const restored = new PodDatabase(target); stores.push(restored)
  const path = await new DependencyStore(restored).verify(f.pod.id, set.hash)
  expect(await readFile(join(path, 'node_modules/sample-package/index.js'), 'utf8')).toBe('module.exports = 42')
  const retention = new DataRetention(restored, '')
  expect((await retention.view()).usedBytes).toBeGreaterThan(0)
  restored.db.prepare('UPDATE pods SET lifecycle=? WHERE id=?').run('archived', f.pod.id)
  await retention.deletePod(f.pod.id, restored.getPod(f.pod.id).revision, f.pod.name)
  expect(new DependencyStore(restored).inventory()).toEqual([])
  await expect(readFile(join(path, 'package.json'))).rejects.toThrow('ENOENT')
})
