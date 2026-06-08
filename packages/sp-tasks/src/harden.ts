// Two layered defences against SQLITE_BUSY under concurrent multi-agent polling:
//  1. hardenSpTaskDb — driver-level: WAL (concurrent readers + one writer) +
//     busy_timeout (the libsql connection waits, not errors, on a held lock).
//  2. withBusyRetry — application-level backstop for the rare BUSY that still
//     surfaces (e.g. a second connection holding the write lock past the timeout).
import { sql } from 'drizzle-orm'
import type { SpTaskDb } from './queue'

const BUSY = /SQLITE_BUSY|database is locked/i

/** Retry a DB op on SQLITE_BUSY/locked with exponential backoff; rethrow anything else. */
export async function withBusyRetry<T>(fn: () => Promise<T>, tries = 5, baseMs = 25): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (i >= tries - 1 || !BUSY.test(msg))
        throw e
      await new Promise(r => setTimeout(r, baseMs * 2 ** i))
    }
  }
}

/** Apply concurrency-safe pragmas to a libsql-backed SpTaskDb. Idempotent. */
export async function hardenSpTaskDb(db: SpTaskDb): Promise<void> {
  await db.run(sql`PRAGMA journal_mode = WAL`)
  await db.run(sql`PRAGMA busy_timeout = 5000`)
}
