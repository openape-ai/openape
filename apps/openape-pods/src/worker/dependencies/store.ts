import { randomUUID } from 'node:crypto'
import { chmod, lstat, readdir, readFile, realpath, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { emptyPackages, parsePackages } from '../../contracts/dependencies'
import type { PackageManifest } from '../../contracts/dependencies'
import type { ScriptRuntime } from '../runs/runner'
import type { PodDatabase } from '../storage/database'
import { podDirectory } from '../../runtime/environment'
import { inspectDomainRecords } from '../recovery/domains'
import { checkLock, dependencyLimit, packageDigest, packageFiles } from './tree'
import type { PackageFile } from './tree'
import { installPackages } from './install'

export async function removePackageTree(path: string): Promise<void> {
  let stat
  try { stat = await lstat(path) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  if (stat.isDirectory()) {
    await chmod(path, 0o700)
    for (const child of await readdir(path)) await removePackageTree(join(path, child))
  }
  await rm(path, { force: true, recursive: true })
}
export class DependencyStore {
  constructor(private readonly store: PodDatabase) {}
  manifest(draftId: string): PackageManifest {
    const row = this.store.db.prepare('SELECT manifest FROM draft_packages WHERE draft_id=?').get(draftId)
    return row ? parsePackages(JSON.parse(row.manifest as string)) : emptyPackages()
  }

  prepared(podId: string, packages: PackageManifest): string | null {
    if (!Object.keys(packages.dependencies).length) return null
    return this.store.db.prepare('SELECT hash FROM dependency_sets WHERE pod_id=? AND manifest=?').get(podId, JSON.stringify(packages))?.hash as string | undefined ?? null
  }

  scriptSet(podId: string, scriptHash: string): string | null {
    return this.store.db.prepare('SELECT dependency_hash FROM script_dependencies WHERE pod_id=? AND script_hash=?').get(podId, scriptHash)?.dependency_hash as string | undefined ?? null
  }

  scriptManifest(podId: string, scriptHash: string): PackageManifest {
    const row = this.store.db.prepare('SELECT d.manifest FROM dependency_sets d JOIN script_dependencies s ON s.pod_id=d.pod_id AND s.dependency_hash=d.hash WHERE s.pod_id=? AND s.script_hash=?').get(podId, scriptHash)
    return row ? parsePackages(JSON.parse(row.manifest as string)) : emptyPackages()
  }

  async verify(podId: string, hash: string): Promise<string> {
    if (!/^[a-f0-9-]{36}$/.test(podId) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid dependency set identity')
    const row = this.store.db.prepare('SELECT * FROM dependency_sets WHERE pod_id=? AND hash=?').get(podId, hash)
    if (!row) throw new Error('Prepared dependencies are missing; prepare them in Script')
    const path = join(await realpath(this.store.root), 'dependencies', podId, hash)
    const files = await packageFiles(path)
    if (packageDigest(files) !== hash || JSON.stringify(files) !== row.files) throw new Error('Prepared dependency contents changed; execution was blocked')
    checkLock(JSON.parse(await readFile(join(path, 'package-lock.json'), 'utf8')), parsePackages(JSON.parse(row.manifest as string)))
    return path
  }

  async prepare(runtime: ScriptRuntime, podId: string, packages: PackageManifest, signal: AbortSignal, current: () => void): Promise<string | null> {
    current()
    if (!Object.keys(packages.dependencies).length) return null
    const existing = this.prepared(podId, packages)
    if (existing) { await this.verify(podId, existing); current(); return existing }
    this.store.assertStorage(dependencyLimit * 3)
    const root = await realpath(this.store.root)
    const stages = await podDirectory(root, 'dependency-staging')
    const stage = await podDirectory(stages, randomUUID())
    const parent = await podDirectory(await podDirectory(root, 'dependencies'), podId)
    let published: string | undefined
    try {
      const project = await installPackages(runtime, stage, packages, signal, (path, pid) => this.store.db.prepare('INSERT INTO dependency_domains VALUES(?,?)').run(path, pid))
      const lock = await readFile(join(project, 'package-lock.json'), 'utf8')
      const files = await packageFiles(project, true); const hash = packageDigest(files)
      signal.throwIfAborted(); current()
      published = join(parent, hash)
      await chmod(project, 0o700)
      await rename(project, published)
      await chmod(published, 0o500)
      this.store.transaction(() => {
        current()
        this.store.db.prepare('INSERT INTO dependency_sets VALUES(?,?,?,?,?)').run(podId, hash, JSON.stringify(packages), lock, JSON.stringify(files))
      })
      published = undefined
      return hash
    }
    catch (error) { if (published) await removePackageTree(published); throw error }
    finally {
      await inspectDomainRecords(this.store.db.prepare('SELECT * FROM dependency_domains WHERE path LIKE ?').all(`${stage}/%`), stages, runtime.helper)
      this.store.db.prepare('DELETE FROM dependency_domains WHERE path LIKE ?').run(`${stage}/%`)
      await removePackageTree(stage)
    }
  }

  async recover(helper: string): Promise<void> {
    const stages = join(this.store.root, 'dependency-staging')
    await inspectDomainRecords(this.store.db.prepare('SELECT * FROM dependency_domains').all(), stages, helper)
    this.store.db.exec('DELETE FROM dependency_domains')
    await removePackageTree(stages)
    const dependencies = join(this.store.root, 'dependencies')
    let pods: string[]
    try { pods = await readdir(dependencies) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    for (const pod of pods) {
      if (!/^[a-f0-9-]{36}$/.test(pod) || !(await lstat(join(dependencies, pod))).isDirectory()) throw new Error('Invalid dependency set identity')
      for (const hash of await readdir(join(dependencies, pod))) {
        if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid dependency set identity')
        if (!this.store.db.prepare('SELECT 1 FROM dependency_sets WHERE pod_id=? AND hash=?').get(pod, hash)) await removePackageTree(join(dependencies, pod, hash))
      }
    }
  }

  inventory(): { podId: string, hash: string, files: PackageFile[] }[] {
    return this.store.db.prepare('SELECT pod_id,hash,files FROM dependency_sets').all().map(row => ({ podId: row.pod_id as string, hash: row.hash as string, files: JSON.parse(row.files as string) as PackageFile[] }))
  }
}
