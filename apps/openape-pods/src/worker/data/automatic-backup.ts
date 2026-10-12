import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PodDatabase } from '../storage/database'
import { assertDataIdle, createBackup, parseBackupManifest } from './backup'
import { removePackageTree } from '../dependencies/store'

/**
 * Verified automatic backups (issue 1465): every six hours while idle, four generations kept. A failed backup is
 * recorded and never removes an earlier verified generation; retention deletes only after a newer one verified.
 */
export const automaticBackups = { intervalMs: 6 * 60 * 60 * 1000, retryMs: 30 * 60 * 1000, keep: 4 } as const
export interface AutomaticBackupStatus { lastSuccessAt: number | null, lastAttemptAt: number | null, lastError: string | null, path: string | null }

/** The status lives in the profile, so a destination that refuses writes still shows why it failed. */
export async function readBackupStatus(root: string): Promise<AutomaticBackupStatus> {
  try { return JSON.parse(await readFile(join(root, 'automatic-backup.json'), 'utf8')) as AutomaticBackupStatus }
  catch { return { lastSuccessAt: null, lastAttemptAt: null, lastError: null, path: null } }
}

async function writeStatus(root: string, status: AutomaticBackupStatus): Promise<void> {
  const stage = join(root, '.automatic-backup.json.stage')
  await writeFile(stage, `${JSON.stringify(status)}\n`, { mode: 0o600 }); await rename(stage, join(root, 'automatic-backup.json'))
}

export async function automaticBackupDue(root: string, now = Date.now()): Promise<boolean> {
  const status = await readBackupStatus(root)
  if (status.lastAttemptAt !== null && status.lastError && now - status.lastAttemptAt < automaticBackups.retryMs) return false
  return status.lastSuccessAt === null || now - status.lastSuccessAt >= automaticBackups.intervalMs
}

/** Verified generations, newest first; an unreadable folder never counts as one and is never deleted here. */
async function generations(directory: string): Promise<{ path: string, createdAt: string }[]> {
  const result: { path: string, createdAt: string }[] = []
  for (const name of await readdir(directory)) {
    if (!name.startsWith('OpenApe-Pods-')) continue
    try { result.push({ path: join(directory, name), createdAt: parseBackupManifest(JSON.parse(await readFile(join(directory, name, 'backup.json'), 'utf8'))).createdAt }) }
    catch { continue }
  }
  return result.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

/** Busy profiles wait for an idle tick. Returns the new backup, or throws after recording why; retention runs only after a verified success. */
export async function runAutomaticBackup(store: PodDatabase, directory: string, now = Date.now()): Promise<string | null> {
  try { assertDataIdle(store) }
  catch { return null }
  const previous = await readBackupStatus(store.root)
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = await createBackup(store, directory)
    await writeStatus(store.root, { lastSuccessAt: now, lastAttemptAt: now, lastError: null, path })
    for (const old of (await generations(directory)).slice(automaticBackups.keep)) await removePackageTree(old.path)
    return path
  }
  catch (error) {
    await writeStatus(store.root, { ...previous, lastAttemptAt: now, lastError: (error instanceof Error ? error.message : 'Backup failed').slice(0, 2000) })
    throw error
  }
}
