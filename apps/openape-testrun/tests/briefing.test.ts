import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateReports } from '../server/database/migrate'
import { validateBriefing } from '../server/utils/briefing-shape'
import { createReportSeries, publishBriefing } from '../server/utils/report-store'
import { sampleBriefing } from './briefing-fixture'

let client: ReturnType<typeof createClient> | undefined
let directory: string | undefined
async function fixture() {
  directory = mkdtempSync(join(tmpdir(), 'briefing-'))
  client = createClient({ url: `file:${join(directory, 'reports.db')}` })
  await migrateReports(client)
  const series = await createReportSeries(client, 'owner@example.com', 'Morning')
  await client.execute({ sql: 'UPDATE report_series SET publisher = ? WHERE id = ?', args: ['publisher@example.com', series.id!] })
  const publish = async (day: string, key = day, changes = {}) => {
    const briefing = validateBriefing({ ...sampleBriefing(String(series.id), day), ...changes })
    return await publishBriefing(client!, briefing, JSON.stringify(briefing), 'publisher@example.com', key)
  }
  return { db: client, series, publish }
}
afterEach(() => { client?.close(); if (directory) rmSync(directory, { recursive: true }); directory = undefined })

describe('briefing publication', () => {
  it('keeps one slug, archives editions and replays the same publication without duplicates', async () => {
    const { db, series, publish } = await fixture()
    expect((await createReportSeries(db, 'owner@example.com', 'Morning')).id).toBe(series.id)
    const first = await publish('2026-09-27')
    expect(await publish('2026-09-27')).toEqual({ ...first, replayed: true })
    const second = await publish('2026-09-28')
    expect(second.slug).toBe(first.slug); expect(second.version).toBe(2)
    expect((await db.execute('SELECT version, status, visibility, created_by FROM runs')).rows).toEqual([{ version: 2, status: null, visibility: 'private', created_by: 'owner@example.com' }])
    expect((await db.execute('SELECT version FROM run_versions')).rows).toEqual([{ version: 1 }])
    await expect(publish('2026-09-27', 'different-key')).rejects.toMatchObject({ statusCode: 409 })
    await expect(publish('2026-09-28', '2026-09-28', { overview: 'Changed' })).rejects.toMatchObject({ statusCode: 409 })
    await expect(publish('2026-09-26')).rejects.toMatchObject({ statusCode: 409 })
    expect((await db.execute('SELECT count(*) AS count FROM report_publications')).rows[0]!.count).toBe(2)
  })
  it('serializes simultaneous daily publications without duplicate editions', async () => {
    const { db, publish } = await fixture()
    const results = await Promise.allSettled([publish('2026-09-27'), publish('2026-09-27')])
    expect(results.every(result => result.status === 'fulfilled')).toBe(true)
    const ids = results.map(result => result.status === 'fulfilled' ? result.value.id : null)
    expect(new Set(ids).size).toBe(1)
    expect((await publish('2026-09-27')).version).toBe(1)
    expect((await db.execute('SELECT count(*) AS count FROM report_publications')).rows[0]!.count).toBe(1)
  })
  it('rolls back archive, head and receipt together when publication fails', async () => {
    const { db, publish } = await fixture()
    await publish('2026-09-27')
    await db.execute('CREATE TRIGGER reject_receipt BEFORE INSERT ON report_publications BEGIN SELECT RAISE(ABORT, \'injected receipt failure\'); END')
    await expect(publish('2026-09-28')).rejects.toThrow('injected receipt failure')
    expect((await db.execute('SELECT version FROM runs')).rows[0]!.version).toBe(1)
    expect((await db.execute('SELECT * FROM run_versions')).rows).toHaveLength(0)
    await db.execute('DROP TRIGGER reject_receipt')
    expect((await publish('2026-09-28')).version).toBe(2)
  })
  it('reevaluates a revoked publisher inside the write transaction', async () => {
    const { db, publish } = await fixture()
    await db.execute('UPDATE report_series SET publisher = NULL')
    await expect(publish('2026-09-27')).rejects.toMatchObject({ statusCode: 404 })
    expect((await db.execute('SELECT * FROM runs')).rows).toHaveLength(0)
  })
})

describe('controlled briefing data', () => {
  it('retains untrusted text literally and accepts valid structured data', () => {
    const value = sampleBriefing()
    value.title = '<script>alert(1)</script>'
    expect(validateBriefing(value).title).toBe(value.title)
  })
  it.each([
    { owner: 'victim@example.com' }, { visibility: 'shared' }, { type: 'test' }, { editionDate: '2026-02-30' }, { generatedAt: '2026-09-28T05:00:00Z' },
    { importantItems: [{ id: 'x', title: 'X', summary: 'Y', priority: 'high', sourceIds: ['unknown'] }] },
    { nextActions: [{ id: 'x', text: 'X', sourceIds: [], url: 'javascript:alert(1)' }] },
    { nextActions: [{ id: 'x', text: 'X', sourceIds: [], url: 'https://user:password@example.com/' }] },
    { overview: 'x'.repeat(2001) },
  ])('rejects unauthorized or malformed input: %j', (changes) => {
    expect(() => validateBriefing({ ...sampleBriefing(), ...changes })).toThrow()
  })
})
