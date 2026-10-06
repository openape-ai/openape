import type { Client } from '@libsql/client'
import { createClient } from '@libsql/client'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { inspectHtml } from '../shared/html-publication'
import { migrateReports } from '../server/database/migrate'
import { manageHtml, publishHtml } from '../server/utils/html-store'
import { discoverLibrary } from '../server/utils/library'

const owner = { subject: 'owner@example.com', actor: 'owner@example.com' }
const reader = { subject: 'reader@example.com', actor: 'reader@example.com' }
const outsider = { subject: 'outsider@example.com', actor: 'outsider@example.com' }
const hour = 3600000
const now = Date.parse('2026-10-06T12:00:00Z')
const html = (title: string) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body><p>${title}</p></body></html>`
let client: Client; let directory: string
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'library-feed-'))
  client = createClient({ url: `file:${join(directory, 'reports.db')}` })
  await migrateReports(client)
})
afterEach(() => { client.close(); rmSync(directory, { recursive: true }) })

async function document(title: string, at: number, options: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) {
  const input = { publication: inspectHtml(html(title), meta), ...options }
  return String((await publishHtml(client, input, JSON.stringify(input), owner, title.replace(/\W+/gu, '-'), 'https://report.example.test', at)).document_id)
}
// Earlier uploads record seconds, not milliseconds.
async function upload(id: string, title: string, at: number, by = owner.subject) {
  await client.execute({ sql: 'INSERT INTO runs (id,slug,report_type,visibility,title,status,passed_count,failed_count,skipped_count,manifest,created_by,created_by_act,created_at,version) VALUES (?,?,\'test\',\'shared\',?,\'failed\',4,1,0,\'{"tests":[]}\',?,\'agent\',?,1)', args: [id, `slug-${id}`, title, by, Math.floor(at / 1000)] })
}
async function everything(identity = owner, filter: Parameters<typeof discoverLibrary>[2] = {}) {
  const items = []; let cursor: string | undefined
  do {
    const page = await discoverLibrary(client, identity, { ...filter, limit: 2, cursor }, now)
    items.push(...page.items); cursor = page.next_cursor ?? undefined
  } while (cursor)
  return items
}

describe('merged library feed', () => {
  it('interleaves earlier uploads with HTML documents by date across cursor pages', async () => {
    await document('Newest report', now - hour)
    await upload('u1', 'Upload from yesterday', now - 24 * hour)
    await document('Report from two days ago', now - 48 * hour, {}, { category: 'Plans', metadata: { 'plans.status': 'active' } })
    await upload('u2', 'Upload from last week', now - 7 * 24 * hour)
    await document('Oldest report', now - 9 * 24 * hour)

    const first = await discoverLibrary(client, owner, { limit: 2 }, now)
    expect(first.facets).toMatchObject({ total: 5, all: 5 })
    expect(first.facets!.categories).toEqual([{ label: 'Plans', count: 1 }, { label: 'Test Runs', count: 2 }, { label: 'Uncategorized', count: 2 }])
    const items = await everything()
    expect(items.map(item => item.title)).toEqual(['Newest report', 'Upload from yesterday', 'Report from two days ago', 'Upload from last week', 'Oldest report'])
    expect(items[1]).toMatchObject({ source: 'upload', href: '/r/slug-u1', audience: 'link', author_type: 'agent', at: now - 24 * hour, test_result: { status: 'failed', passed: 4, failed: 1 } })
    expect(items[2]).toMatchObject({ source: 'html', category: 'Plans', plan_status: 'active', author_type: null, audience: 'private' })
    expect((await everything(owner, { sort: 'title' })).map(item => item.title)).toEqual(['Newest report', 'Oldest report', 'Report from two days ago', 'Upload from last week', 'Upload from yesterday'])
  })

  it('keeps access isolation and excludes removed reports', async () => {
    await document('Private report', now - hour)
    await document('Shared with a reader', now - 2 * hour, { audience: { mode: 'readers', readers: [reader.subject] } })
    const removed = await document('Removed report', now - 3 * hour)
    await manageHtml(client, removed, owner, 'remove', { expectedVersion: 1 }, now - hour)
    await upload('u1', 'Owner upload', now - 4 * hour)
    await upload('u2', 'Someone else upload', now - 4 * hour, outsider.subject)

    expect((await everything()).map(item => item.title)).toEqual(['Private report', 'Shared with a reader', 'Owner upload'])
    expect((await everything(reader)).map(item => item.title)).toEqual(['Shared with a reader'])
    expect((await everything(outsider)).map(item => item.title)).toEqual(['Someone else upload'])
  })

  it('applies filters that earlier uploads cannot satisfy by leaving them out', async () => {
    await document('Tagged plan', now - hour, {}, { tags: ['release'], metadata: { 'plans.status': 'active' } })
    await upload('u1', 'Release upload', now - 2 * hour)
    expect((await everything(owner, { tags: 'release' })).map(item => item.title)).toEqual(['Tagged plan'])
    expect((await everything(owner, { field: 'plans.status', value: 'active' })).map(item => item.title)).toEqual(['Tagged plan'])
    expect((await everything(owner, { access: 'link' })).map(item => item.title)).toEqual(['Release upload'])
    expect((await everything(owner, { search: 'RELEASE' })).map(item => item.title)).toEqual(['Tagged plan', 'Release upload'])
    expect((await discoverLibrary(client, owner, {}, now)).facets!.tags).toEqual([{ label: 'release', count: 1 }])
  })

  it('rejects malformed paging and filters', async () => {
    for (const filter of [{ limit: 0 }, { limit: 101 }, { cursor: 'not a cursor' }, { cursor: Buffer.from('["x","y"]').toString('base64url') }, { access: 'everyone' }, { sort: 'size' }, { field: 'plans.status' }]) {
      await expect(discoverLibrary(client, owner, filter, now)).rejects.toMatchObject({ status: 400 })
    }
  })
})
