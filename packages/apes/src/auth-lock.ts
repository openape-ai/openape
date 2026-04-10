import type { FileHandle } from 'node:fs/promises'
import { open, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { CONFIG_DIR } from './config'

const LOCK_FILE = join(CONFIG_DIR, 'auth.json.lock')

export interface AuthLock {
  handle: FileHandle
}

/**
 * Best-effort exclusive file lock to serialize concurrent token refreshes
 * between parallel apes / ape-shell invocations. Uses O_CREAT|O_EXCL which
 * is atomic on POSIX. Returns null on timeout so the caller can fall back
 * to "just re-read auth.json" (the assumption being that another process
 * successfully refreshed in the meantime).
 *
 * A stale lock older than 30s is considered abandoned (from a crashed
 * process) and is removed so the next acquire can proceed.
 */
export async function acquireAuthLock(
  opts: { timeoutMs?: number } = {},
): Promise<AuthLock | null> {
  const deadline = Date.now() + (opts.timeoutMs ?? 5000)
  while (Date.now() < deadline) {
    try {
      const handle = await open(LOCK_FILE, 'wx')
      return { handle }
    }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST')
        throw err
      // Stale lock? If the file is older than 30s, remove it and retry.
      try {
        const s = await stat(LOCK_FILE)
        if (Date.now() - s.mtimeMs > 30_000)
          await rm(LOCK_FILE, { force: true })
      }
      catch {
        // File gone between stat and rm — next iteration will retry the open.
      }
      await new Promise(r => setTimeout(r, 100))
    }
  }
  return null
}

export async function releaseAuthLock(lock: AuthLock): Promise<void> {
  try {
    await lock.handle.close()
  }
  finally {
    await rm(LOCK_FILE, { force: true })
  }
}
