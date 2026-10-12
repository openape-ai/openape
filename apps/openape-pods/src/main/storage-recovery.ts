import { constants } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, open, readdir, readFile, rename, statfs, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import type { StorageBackup, StorageDiagnostics, StorageFile } from '../contracts/storage'
import { parseBackupManifest } from '../worker/data/backup'
import { readBackupStatus } from '../worker/data/automatic-backup'

/** The database set that recovery preserves together; deleting a WAL or journal to force an open loses commits. */
export const databaseSet = ['control.sqlite', 'control.sqlite-wal', 'control.sqlite-shm', 'control.sqlite-journal']

/** Automatic backups live next to, never inside, the profile base, so a damaged profile cannot take them along. */
export function automaticBackupDirectory(profileBase: string): string { return join(dirname(profileBase), `${basename(profileBase)} Backups`) }
export function recoveryCopyDirectory(profileBase: string): string { return join(dirname(profileBase), `${basename(profileBase)} Recovery`) }

/** File facts and the SQLite header, read without opening the database, so diagnosis never writes to it. */
export async function storageDiagnostics(root: string): Promise<StorageDiagnostics> {
  const files: StorageFile[] = []
  for (const name of databaseSet) {
    try { const info = await lstat(join(root, name)); files.push({ name, size: info.size, modifiedAt: Math.round(info.mtimeMs) }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') files.push({ name, size: -1, modifiedAt: 0 }) }
  }
  let header: StorageDiagnostics['header'] = null
  try {
    const file = await open(join(root, 'control.sqlite'), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const bytes = Buffer.alloc(100); const { bytesRead } = await file.read(bytes, 0, 100, 0)
      const sqlite = bytesRead === 100 && bytes.subarray(0, 16).toString('latin1') === 'SQLite format 3\0'
      const page = sqlite ? bytes.readUInt16BE(16) : null
      header = { sqlite, pageSize: page === 1 ? 65536 : page, schema: sqlite ? bytes.readUInt32BE(60) : null }
    }
    finally { await file.close() }
  }
  catch { header = null }
  let freeBytes: number | null = null
  try { const disk = await statfs(root); freeBytes = disk.bavail * disk.bsize }
  catch { freeBytes = null }
  return { profile: root, files, header, freeBytes }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256'); const file = await open(path, 'r')
  try { for await (const chunk of file.createReadStream()) hash.update(chunk as Buffer) }
  finally { await file.close() }
  return hash.digest('hex')
}

/** Backups in a directory with their verification: manifest, database size and digest. */
export async function listBackups(directory: string, automatic: boolean): Promise<StorageBackup[]> {
  let names: string[]
  try { names = (await readdir(directory)).filter(name => name.startsWith('OpenApe-Pods-')) }
  catch { return [] }
  const backups: StorageBackup[] = []
  for (const name of names.sort().reverse().slice(0, 12)) {
    const path = join(directory, name)
    try {
      const manifest = parseBackupManifest(JSON.parse(await readFile(join(path, 'backup.json'), 'utf8')))
      const database = manifest.files.find(file => file.path === 'control.sqlite')!
      const info = await lstat(join(path, 'control.sqlite'))
      const problem = info.size !== database.size || await sha256(join(path, 'control.sqlite')) !== database.hash ? 'The database copy differs from its manifest' : null
      backups.push({ path, createdAt: manifest.createdAt, schema: manifest.schema, bytes: manifest.files.reduce((sum, file) => sum + file.size, 0), files: manifest.files.length, valid: !problem, problem, automatic })
    }
    catch (error) {
      backups.push({ path, createdAt: '', schema: 0, bytes: 0, files: 0, valid: false, problem: error instanceof Error ? error.message.slice(0, 300) : 'Unreadable backup', automatic })
    }
  }
  return backups
}

/**
 * Copies the database set as it is (with its WAL and journal) into a new read-only recovery folder with digests.
 * The originals stay untouched; this copy is for diagnosis or a later salvage, never promoted automatically.
 */
export async function preserveRecoveryCopy(root: string, profileBase: string): Promise<string> {
  const parent = recoveryCopyDirectory(profileBase)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const name = `recovery-${new Date().toISOString().replaceAll(':', '-')}`
  const stage = join(parent, `.${name}`); await mkdir(stage, { mode: 0o700 })
  const copied: { name: string, size: number, sha256: string }[] = []
  for (const file of databaseSet) {
    try { await copyFile(join(root, file), join(stage, file), constants.COPYFILE_EXCL) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
    await chmod(join(stage, file), 0o400)
    copied.push({ name: file, size: (await lstat(join(stage, file))).size, sha256: await sha256(join(stage, file)) })
  }
  if (!copied.length) throw new Error('No database file exists to preserve')
  await writeFile(join(stage, 'recovery.json'), `${JSON.stringify({ format: 'openape-pods-recovery-copy', version: 1, source: root, createdAt: new Date().toISOString(), files: copied }, null, 2)}\n`, { mode: 0o400 })
  await rename(stage, join(parent, name))
  return join(parent, name)
}

export async function recoveryCopies(profileBase: string): Promise<string[]> {
  try { return (await readdir(recoveryCopyDirectory(profileBase))).filter(name => name.startsWith('recovery-')).sort().reverse().map(name => join(recoveryCopyDirectory(profileBase), name)) }
  catch { return [] }
}

export async function automaticBackupStatus(root: string): Promise<{ at: number | null, error: string | null }> {
  const status = await readBackupStatus(root)
  return { at: status.lastSuccessAt, error: status.lastError }
}
