import { accessSync, constants, existsSync, lstatSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StorageFailure, StorageReason } from '../../contracts/storage'
import { PodDatabase } from './database'
import { StorageError } from './errors'

export { StorageError }

const sqliteReasons: Record<number, StorageReason> = { 3: 'permission', 5: 'busy', 6: 'busy', 8: 'permission', 10: 'io', 11: 'corrupt', 13: 'disk-full', 14: 'io', 23: 'permission', 26: 'corrupt' }
const systemReasons: Record<string, StorageReason> = { EACCES: 'permission', EPERM: 'permission', EROFS: 'permission', ENOSPC: 'disk-full', EDQUOT: 'disk-full', EIO: 'io' }
const messageReasons: [RegExp, StorageReason][] = [
  [/needs a newer application/, 'schema-newer'],
  [/created by an older OpenApe Pods version|cannot be upgraded|does not have the schema/, 'schema-older'],
  [/Database integrity check failed|file is not a database|malformed/, 'corrupt'],
  [/Incomplete or altered storage|Invalid references|inconsistent reference|lost rows/, 'invalid-data'],
  [/database is locked|database is busy/, 'busy'],
]

/** A timeout or failed check is never reported as corruption; only SQLite's own corruption results are. */
export function classifyStorageError(error: unknown, at = Date.now()): StorageFailure {
  const message = (error instanceof Error ? error.message : 'The database could not be opened').slice(0, 2000)
  if (error instanceof StorageError) return { reason: error.reason, message, at }
  const { errcode, code } = (error ?? {}) as { errcode?: unknown, code?: unknown }
  const reason = (typeof errcode === 'number' ? sqliteReasons[errcode & 0xFF] : undefined)
    ?? (typeof code === 'string' ? systemReasons[code] : undefined)
    ?? messageReasons.find(([pattern]) => pattern.test(message))?.[1]
    ?? 'unknown'
  return { reason, message, at }
}

const marker = 'storage.json'
function nonEmpty(path: string): boolean {
  try { return readdirSync(path).some(name => !name.startsWith('.')) }
  catch { return false }
}

/** An existing profile: it once had a database (marker) or holds data that only a database references. */
export function hasProfileContent(root: string): boolean {
  return existsSync(join(root, marker)) || existsSync(join(root, 'remote', 'registration.enc')) || ['pods', 'blobs', 'runs', 'snapshots'].some(name => nonEmpty(join(root, name)))
}

function sleep(ms: number): void { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }

/**
 * Opens the profile database with bounded retries for a busy database. A missing database in a profile with content is
 * a recovery case, never a silent new start; only an empty profile starts fresh.
 */
export function openStorage(root: string, attempts = 3): PodDatabase {
  const path = join(root, 'control.sqlite')
  if (!existsSync(path) && hasProfileContent(root)) throw new StorageError('missing', 'The database of this profile is missing while its other data remains. Pods does not start an empty database over it; restore a backup or put the database back.')
  const auxiliary = ['-wal', '-shm'].filter(suffix => !existsSync(`${path}${suffix}`))
  try { return open(root, attempts) }
  catch (error) {
    // Opening a WAL database creates its index files; a failed open leaves the set as it found it.
    for (const file of auxiliary.map(suffix => `${path}${suffix}`).filter(existsSync)) {
      if (file.endsWith('-shm') || lstatSync(file).size === 0) rmSync(file)
    }
    if ((error as { errcode?: unknown }).errcode === 14 && existsSync(path)) {
      try { accessSync(path, constants.R_OK | constants.W_OK) }
      catch { throw new StorageError('permission', 'Pods may not read or write its database file') }
    }
    throw error
  }
}

function open(root: string, attempts: number): PodDatabase {
  for (let attempt = 1; ; attempt++) {
    try {
      const store = new PodDatabase(root)
      if (!existsSync(join(root, marker))) {
        const stage = join(root, `.${marker}.stage`)
        writeFileSync(stage, `${JSON.stringify({ format: 'openape-pods-storage', version: 1, createdAt: new Date().toISOString() })}\n`, { mode: 0o600 })
        renameSync(stage, join(root, marker))
      }
      return store
    }
    catch (error) {
      if (attempt >= attempts || classifyStorageError(error).reason !== 'busy') throw error
      sleep(attempt * 1000)
    }
  }
}

let opened: PodDatabase | undefined
export function setOpenedStore(store: PodDatabase): void { opened = store }
/** The database the worker opened before its runtime modules load. */
export function openedStore(): PodDatabase {
  if (!opened) throw new Error('Storage is not ready')
  return opened
}
