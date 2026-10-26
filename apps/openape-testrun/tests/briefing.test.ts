import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateReports } from '../server/database/migrate'
import { validateBriefing } from '../server/utils/briefing-shape'
import { createReportSeries, publishBriefing } from '../server/utils/report-store'
import { sampleBriefing, sampleBriefingV2 } from './briefing-fixture'

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
    { owner: 'victim@example.com' },
    { visibility: 'shared' },
    { type: 'test' },
    { editionDate: '2026-02-30' },
    { generatedAt: '2026-09-28T05:00:00Z' },
    { importantItems: [{ id: 'x', title: 'X', summary: 'Y', priority: 'high', sourceIds: ['unknown'] }] },
    { nextActions: [{ id: 'x', text: 'X', sourceIds: [], url: 'javascript:alert(1)' }] },
    { nextActions: [{ id: 'x', text: 'X', sourceIds: [], url: 'https://user:password@example.com/' }] },
    { overview: 'x'.repeat(2001) },
  ])('rejects unauthorized or malformed input: %j', (changes) => {
    expect(() => validateBriefing({ ...sampleBriefing(), ...changes })).toThrow()
  })
})

describe('versioned briefing presentation', () => {
  it('preserves exact information and rejects presentation fields on legacy input', () => {
    const report = sampleBriefingV2()
    expect(validateBriefing(report)).toEqual(report)
    expect(() => validateBriefing({ ...report, schemaVersion: 1 })).toThrow()
    expect(() => validateBriefing({ ...report, schemaVersion: 3 })).toThrow()
  })
  it.each([
    ['missing email', (report: ReturnType<typeof sampleBriefingV2>) => { report.topics.pop() }],
    ['duplicate reference', (report) => { report.topics[0]!.references.push(report.topics[1]!.references[0]!) }],
    ['unknown reference', (report) => { report.topics[0]!.references[0]!.emailId = 'unknown' }],
    ['duplicate mail', (report) => { report.emails.push(report.emails[0]!) }],
    ['duplicate topic', (report) => { report.topics[1]!.id = report.topics[0]!.id }],
    ['duplicate information', (report) => { report.emails[3]!.informationItems!.push(report.emails[3]!.informationItems![0]!) }],
    ['missing information', (report) => { delete report.emails[3]!.informationItems }],
    ['missing coverage', (report) => { report.sourceCoverage.pop() }],
    ['unknown source', (report) => { report.sourceCoverage[0]!.sourceId = 'unknown' }],
    ['inaccurate included count', (report) => { report.sourceCoverage[0]!.included = 4 }],
    ['inaccurate information count', (report) => { report.sourceCoverage[1]!.informationItems = 0 }],
    ['false complete coverage', (report) => { report.sourceCoverage[0]!.status = 'complete' }],
    ['negative count', (report) => { report.sourceCoverage[0]!.available = -1 }],
  ])('rejects %s', (_name, change) => {
    const report = sampleBriefingV2()
    change(report)
    expect(() => validateBriefing(report)).toThrow()
  })
  it('enforces three focus topics and rejects unknown presentation fields', () => {
    const report = sampleBriefingV2()
    report.topics = report.emails.map((mail, index) => ({ ...report.topics[0]!, id: String(index), references: [{ account: mail.account, emailId: mail.id }], placement: 'focus' }))
    expect(() => validateBriefing(report)).toThrow()
    expect(() => validateBriefing({ ...sampleBriefingV2(), sourceCoverage: [{ ...sampleBriefingV2().sourceCoverage[0], extra: true }] })).toThrow()
  })
  it('preserves unknown coverage instead of reporting zero', () => {
    const report = sampleBriefingV2()
    Object.assign(report.sourceCoverage[0]!, { available: null, scanned: null, status: 'unknown' })
    expect(validateBriefing(report)).toMatchObject({ sourceCoverage: [{ available: null, scanned: null, status: 'unknown' }, {}] })
  })
  it('archives v1 alongside v2 and replays the exact v2 publication', async () => {
    const { db, series, publish } = await fixture()
    await publish('2026-10-25')
    const report = validateBriefing(sampleBriefingV2(String(series.id)))
    const raw = JSON.stringify(report)
    const result = await publishBriefing(db, report, raw, 'publisher@example.com', 'v2')
    expect(result.version).toBe(2)
    expect(await publishBriefing(db, report, raw, 'publisher@example.com', 'v2')).toEqual({ ...result, replayed: true })
    expect(JSON.parse(String((await db.execute('SELECT manifest FROM run_versions')).rows[0]!.manifest)).schemaVersion).toBe(1)
    expect(JSON.parse(String((await db.execute('SELECT manifest FROM runs')).rows[0]!.manifest)).schemaVersion).toBe(2)
  })
})

describe('calendar presentation', () => {
  it('separates all-day entries and detects only real timed overlaps', async () => {
    const { occursOn, calendarConflicts } = await import('../app/utils/briefing-calendar')
    const report = sampleBriefingV2()
    expect(report.calendar.filter(event => !event.allDay && occursOn(event, report.editionDate))).toHaveLength(0)
    expect(occursOn(report.calendar[0]!, '2026-10-26')).toBe(true)
    expect(occursOn(report.calendar[0]!, '2026-10-27')).toBe(false)
    expect(calendarConflicts(report.calendar)).toMatchObject([{ minutes: 30, start: '2026-11-02T07:30:00.000Z' }])
    const event = report.calendar[1]!
    expect(calendarConflicts([event, event])).toEqual([])
    expect(calendarConflicts([event, { ...event, id: 'adjacent', start: event.end, end: '2026-11-02T10:00:00+01:00' }])).toEqual([])
  })
  it('respects Vienna day boundaries and the repeated DST hour', async () => {
    const { occursOn, calendarConflicts } = await import('../app/utils/briefing-calendar')
    const event = { ...sampleBriefingV2().calendar[1]!, start: '2026-10-24T23:00:00+02:00', end: '2026-10-26T00:00:00+01:00' }
    expect(occursOn(event, '2026-10-24')).toBe(true)
    expect(occursOn(event, '2026-10-25')).toBe(true)
    expect(occursOn(event, '2026-10-26')).toBe(false)
    const first = { ...event, id: 'first', start: '2026-10-25T02:00:00+02:00', end: '2026-10-25T02:30:00+02:00' }
    const second = { ...event, id: 'second', start: '2026-10-25T02:00:00+01:00', end: '2026-10-25T02:30:00+01:00' }
    expect(calendarConflicts([first, second])).toEqual([])
  })
})
