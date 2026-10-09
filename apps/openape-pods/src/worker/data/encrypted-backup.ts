import { createHash } from 'node:crypto'
import { lstat, mkdir, readdir, realpath, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { syncDirectory } from './files'

async function stagingPath(localProfileRoot: string): Promise<string> {
  const profile = await realpath(localProfileRoot)
  return join(dirname(profile), `OpenApe-Pods-backup-staging-${createHash('sha256').update(profile).digest('hex').slice(0, 16)}`)
}
async function assertPrivateStaging(staging: string): Promise<void> {
  const info = await lstat(staging)
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error('Encrypted backup staging requires a private local application directory')
}
export async function encryptedBackupStaging(localProfileRoot: string): Promise<string> {
  const staging = await stagingPath(localProfileRoot)
  try { await mkdir(staging, { mode: 0o700 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  await assertPrivateStaging(staging)
  return staging
}

export async function cleanupEncryptedBackupStaging(localProfileRoot: string): Promise<void> {
  const staging = await stagingPath(localProfileRoot)
  try { await assertPrivateStaging(staging) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  let unsupported = false
  for (const name of await readdir(staging)) {
    const path = join(staging, name); const info = await lstat(path)
    if (name === '.DS_Store' && info.isFile()) continue
    if (!/^\.(?:seal-source|unseal)-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(name) || !info.isDirectory() || info.isSymbolicLink()) { unsupported = true; continue }
    await rm(path, { recursive: true, force: true })
  }
  await syncDirectory(staging)
  if (unsupported) throw new Error('Unsupported encrypted backup staging entry')
}
