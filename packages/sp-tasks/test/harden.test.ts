import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hardenSpTaskDb, withBusyRetry } from '../src/harden'
import { agentTasks } from '../src/schema'

describe('withBusyRetry', () => {
  it('retries on SQLITE_BUSY and resolves when fn eventually succeeds', async () => {
    let calls = 0
    const fn = async () => {
      calls++
      if (calls <= 2)
        throw new Error('SQLITE_BUSY: database is locked')
      return 'ok'
    }
    const result = await withBusyRetry(fn, 5, 1)
    expect(result).toBe('ok')
    expect(calls).toBe(3)
  })

  it('rejects immediately on a non-BUSY error and calls fn exactly once', async () => {
    let calls = 0
    const fn = async () => {
      calls++
      throw new Error('boom')
    }
    await expect(withBusyRetry(fn, 5, 1)).rejects.toThrow('boom')
    expect(calls).toBe(1)
  })

  it('rejects after exhausting tries when fn always throws BUSY', async () => {
    let calls = 0
    const fn = async () => {
      calls++
      throw new Error('SQLITE_BUSY: database is locked')
    }
    await expect(withBusyRetry(fn, 3, 1)).rejects.toThrow('SQLITE_BUSY')
    expect(calls).toBe(3)
  })
})

describe('hardenSpTaskDb', () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sp-tasks-harden-test-'))
    dbPath = join(tmpDir, 'test.db')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('runs without throwing on a file-backed db', async () => {
    const client = createClient({ url: `file:${dbPath}` })
    const db = drizzle(client, { schema: { agentTasks } })
    await expect(hardenSpTaskDb(db)).resolves.toBeUndefined()
    await client.close()
  })

  it('sets journal_mode to WAL and busy_timeout on a file-backed db', async () => {
    const client = createClient({ url: `file:${dbPath}` })
    const db = drizzle(client, { schema: { agentTasks } })
    await hardenSpTaskDb(db)
    // rows are arrays: [[value]]
    const journal = await db.run(sql`PRAGMA journal_mode`)
    expect(journal.rows[0]?.[0]).toBe('wal')
    const timeout = await db.run(sql`PRAGMA busy_timeout`)
    expect(timeout.rows[0]?.[0]).toBe(5000)
    await client.close()
  })
})
