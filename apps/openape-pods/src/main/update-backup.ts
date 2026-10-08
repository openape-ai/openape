import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, cp, lstat, mkdir, readdir, readlink, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

async function hash(path: string): Promise<string> {
  const digest = createHash('sha256')
  for await (const bytes of createReadStream(path)) digest.update(bytes)
  return digest.digest('hex')
}
async function inventory(root: string, prefix = '', profile = true): Promise<Record<string, string>> {
  const result: Record<string, string> = Object.create(null)
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (profile && !prefix && ['chromium', 'control.sqlite-shm', 'control.sqlite-wal'].includes(entry.name)) continue
    if (entry.isDirectory()) Object.assign(result, await inventory(root, path, profile))
    else if (entry.isFile()) result[path] = await hash(join(root, path))
    else if (entry.isSymbolicLink()) result[path] = `symlink:${await readlink(join(root, path))}`
    else if (!entry.isSocket()) throw new Error(`Cannot back up profile entry: ${path}`)
  }
  return result
}
export async function backupForUpdate(profile: string, installedApp: string, parent: string): Promise<string> {
  await mkdir(parent, { recursive: true, mode: 0o700 }); await chmod(parent, 0o700)
  const stage = join(parent, `.preparing-${randomUUID()}`)
  await mkdir(stage, { mode: 0o700 })
  try {
    const before = await inventory(profile)
    const destination = join(stage, 'profile')
    await cp(profile, destination, { recursive: true, verbatimSymlinks: true, filter: async (source) => {
      if (['chromium', 'control.sqlite-shm', 'control.sqlite-wal'].some(name => source === join(profile, name))) return false
      return !(await lstat(source)).isSocket()
    } })
    const copied = await inventory(destination); const after = await inventory(profile)
    for (const records of [copied, after]) {
      if (Object.keys(records).length !== Object.keys(before).length || Object.entries(before).some(([path, digest]) => records[path] !== digest)) throw new Error('Profile changed during update backup')
    }
    await cp(installedApp, join(stage, 'OpenApe Pods.app'), { recursive: true, verbatimSymlinks: true })
    const appFiles = await inventory(installedApp, '', false)
    const appCopy = await inventory(join(stage, 'OpenApe Pods.app'), '', false)
    if (Object.keys(appFiles).length !== Object.keys(appCopy).length || Object.entries(appFiles).some(([path, digest]) => appCopy[path] !== digest)) throw new Error('Application backup verification failed')
    await writeFile(join(stage, 'backup.json'), JSON.stringify({ format: 'openape-pods-update-backup', version: 1, profile, files: before, appFiles, createdAt: new Date().toISOString(), recovery: 'Retain the system Keychain. Reconcile remote sessions and effects before restoring this profile with its paired app.' }, null, 2), { mode: 0o600 })
    const target = join(parent, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`)
    await rename(stage, target)
    return target
  }
  catch (error) { await rm(stage, { recursive: true, force: true }); throw error }
}
