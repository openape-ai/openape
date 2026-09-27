import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateReports } from '../server/database/migrate'

const directories: string[] = []
const clients: ReturnType<typeof createClient>[] = []
function database() {
  const directory = mkdtempSync(join(tmpdir(), 'reports-migration-'))
  directories.push(directory)
  const client = createClient({ url: `file:${join(directory, 'reports.db')}` })
  clients.push(client)
  return client
}
afterEach(() => { for (const client of clients.splice(0)) client.close(); for (const path of directories.splice(0)) rmSync(path, { recursive: true }) })

describe('report storage migration', () => {
  it('preserves legacy report identity, version and asset bytes across repeated startup', async () => {
    const client = database()
    await migrateReports(client)
    await client.execute('ALTER TABLE runs DROP COLUMN report_type')
    await client.execute('ALTER TABLE runs DROP COLUMN visibility')
    await client.execute('ALTER TABLE run_versions DROP COLUMN report_type')
    await client.execute('INSERT INTO runs (id, slug, title, status, manifest, created_by, created_at, version) VALUES (\'run\', \'old-link\', \'Old report\', \'passed\', \'{}\', \'owner@example.com\', 1, 3)')
    await client.execute({ sql: 'INSERT INTO assets (id, run_id, path, content_type, size, bytes, created_at, version) VALUES (\'shot\', \'run\', \'shot.png\', \'image/png\', 3, ?, 1, 1)', args: [new Uint8Array([1, 2, 3])] })
    await migrateReports(client)
    await migrateReports(client)
    expect((await client.execute('SELECT slug, version, report_type, visibility FROM runs')).rows[0]).toEqual({ slug: 'old-link', version: 3, report_type: 'test', visibility: 'shared' })
    const asset = (await client.execute('SELECT bytes, version FROM assets')).rows[0]!
    expect(new Uint8Array(asset.bytes as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]))
    expect(asset.version).toBe(1)
  })

  it('rolls back and reports incompatible storage instead of continuing startup', async () => {
    const client = database()
    await client.execute('CREATE TABLE assets (id TEXT PRIMARY KEY)')
    await expect(migrateReports(client)).rejects.toThrow()
    expect((await client.execute('SELECT name FROM sqlite_master WHERE name = \'runs\'')).rows).toHaveLength(0)
    expect((await client.execute('PRAGMA table_info(assets)')).rows.map(row => row.name)).toEqual(['id'])
  })
})
