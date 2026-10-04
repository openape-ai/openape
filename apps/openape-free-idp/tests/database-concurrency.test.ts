import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'

it('commits grant writes while another connection retains an older read snapshot', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'idp-reader-'))
  const url = `file:${join(directory, 'idp.sqlite')}`
  const client = createClient({ url })
  const reader = createClient({ url })
  const database = drizzle(client)
  vi.doMock('../server/database/drizzle', () => ({ useDb: () => database }))
  vi.doMock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({ tursoUrl: url }) }))
  vi.stubEnv('OPENAPE_E2E', '0')
  vi.stubGlobal('defineNitroPlugin', (initialize: () => Promise<void>) => initialize())
  try {
    await (await import('../server/plugins/02.database')).default
    await client.execute('INSERT INTO grants(id,status,requester,target_host,audience,grant_type,request,created_at) VALUES(\'fixture\',\'pending\',\'fixture@example.test\',\'pods:fixture\',\'shapes\',\'once\',\'{}\',1)')
    const snapshot = await reader.transaction('read')
    try {
      expect((await snapshot.execute('SELECT status FROM grants WHERE id=\'fixture\'')).rows[0]?.status).toBe('pending')
      await database.transaction(async (tx) => {
        await tx.run(sql`UPDATE grants SET status='denied' WHERE id='fixture'`)
      })
      expect((await snapshot.execute('SELECT status FROM grants WHERE id=\'fixture\'')).rows[0]?.status).toBe('pending')
    }
    finally { await snapshot.rollback(); snapshot.close() }
    expect((await reader.execute('SELECT status FROM grants WHERE id=\'fixture\'')).rows[0]?.status).toBe('denied')
    expect((await client.execute('PRAGMA journal_mode')).rows[0]?.journal_mode).toBe('wal')
  }
  finally {
    reader.close(); client.close()
    vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.doUnmock('../server/database/drizzle'); vi.doUnmock('nitropack/runtime'); vi.resetModules()
    rmSync(directory, { recursive: true, force: true })
  }
})
