import type { Client } from '@libsql/client'
import { createClient } from '@libsql/client'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EMBEDDED_RESOURCE_LIMIT, HTML_LIMIT, inspectHtml, lifetime, RECOVERY_MS } from '../shared/html-publication'
import { migrateReports } from '../server/database/migrate'
import { discoverHtml, discoverLabels } from '../server/utils/html-discovery'
import { initializeHtmlPolicyJournal } from '../server/utils/html-policy-journal'
import { documentRow, manageHtml, publishHtml, purgeHtml, readHtml, row, transaction } from '../server/utils/html-store'

const owner = { subject: 'owner@example.com', actor: 'owner@example.com' }
const reader = { subject: 'reader@example.com', actor: 'reader@example.com' }
const outsider = { subject: 'outsider@example.com', actor: 'outsider@example.com' }
const base = 'https://report.example.test'
const now = Date.parse('2026-10-06T12:00:00Z')
const html = '<!doctype html><html lang="en"><head><title>Capacity</title></head><body><p>12</p><script>document.body.dataset.ready="true"</script></body></html>'
let client: Client; let directory: string
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'html-reports-'))
  client = createClient({ url: `file:${join(directory, 'reports.db')}` })
  await migrateReports(client)
})
afterEach(() => { client.close(); rmSync(directory, { recursive: true }) })
function publish(options: Parameters<typeof publishHtml>[1] = {}, key = 'first', timestamp = now) {
  const input = { publication: inspectHtml(html), ...options }
  return publishHtml(client, input, JSON.stringify(input), owner, key, base, timestamp)
}

describe('single HTML publication and lifecycle', () => {
  it('publishes exact bytes privately and permanently, with atomic retries and immutable revisions', async () => {
    const [first, retry] = await Promise.all([publish(), publish()])
    expect(retry).toMatchObject({ document_id: first.document_id, version: 1, replayed: true, audience: 'private', expires_at: null })
    await expect(readHtml(client, String(first.document_id), null, undefined, now)).rejects.toMatchObject({ status: 404 })
    await expect(readHtml(client, String(first.document_id), outsider, undefined, now)).rejects.toMatchObject({ status: 404 })
    const second = await publish({ documentId: String(first.document_id), expectedVersion: 1, publication: inspectHtml(html.replace('<p>12</p>', '<p>24</p>')) }, 'second')
    expect(second).toMatchObject({ version: 2, url: first.url })
    expect((await readHtml(client, String(first.document_id), owner, 1, now)).version.html).toBe(html)
    await expect(publish({ documentId: String(first.document_id), expectedVersion: 1 }, 'stale')).rejects.toMatchObject({ status: 409 })
    await expect(publish({ publication: inspectHtml(html, { title: 'Changed' }) })).rejects.toMatchObject({ status: 409 })
    expect((await client.execute('SELECT * FROM html_versions')).rows).toHaveLength(2)
  })

  it('keeps metadata versions distinct from current access policy across every old edition', async () => {
    const first = await publish({ audience: { mode: 'readers', readers: [reader.subject] } })
    const id = String(first.document_id)
    await readHtml(client, id, reader, 1, now)
    await expect(manageHtml(client, id, reader, 'access', { audience: { mode: 'public' }, expectedAccessRevision: 1 }, now)).rejects.toMatchObject({ status: 403 })
    await publishHtml(client, { documentId: id, expectedVersion: 1, changes: { tags: ['REPORTS', 'reports'], metadata: { 'plans.status': 'active' } } }, 'metadata-change', owner, 'metadata', base, now)
    expect((await readHtml(client, id, owner, 2, now)).version.tags).toBe('["reports"]')
    expect((await readHtml(client, id, owner, 1, now)).version.tags).toBe('[]')
    await manageHtml(client, id, owner, 'access', { audience: { mode: 'public' }, expectedAccessRevision: 1 }, now)
    await readHtml(client, id, null, 1, now)
    await manageHtml(client, id, owner, 'access', { audience: { mode: 'private' }, expectedAccessRevision: 2 }, now)
    for (const revision of [1, 2]) await expect(readHtml(client, id, reader, revision, now)).rejects.toMatchObject({ status: 404 })
    await expect(manageHtml(client, id, owner, 'access', { audience: { mode: 'public' }, expectedAccessRevision: 1 }, now)).rejects.toMatchObject({ status: 409 })
  })

  it('denies expiry without cleanup, never renews on update, and restores only privately with a new lifetime', async () => {
    const first = await publish({ audience: { mode: 'public' }, lifetime: { expiresIn: '1m' } })
    const id = String(first.document_id)
    const second = await publish({ documentId: id, expectedVersion: 1 }, 'second', now + 30000)
    expect(second.expires_at).toBe(now + 60000)
    for (const revision of [1, 2]) await expect(readHtml(client, id, null, revision, now + 60000)).rejects.toMatchObject({ status: 410 })
    await expect(publish({ documentId: id, expectedVersion: 2 }, 'late', now + 60000)).rejects.toMatchObject({ status: 410 })
    await expect(manageHtml(client, id, owner, 'retention', { lifetime: { permanent: true }, expectedRetentionRevision: 1 }, now + 60000)).rejects.toMatchObject({ status: 410 })
    await expect(manageHtml(client, id, owner, 'restore', {}, now + 60001)).rejects.toThrow()
    await manageHtml(client, id, owner, 'restore', { lifetime: { permanent: true } }, now + 60001)
    const restored = await readHtml(client, id, owner, 1, now + 60002)
    expect(restored.document).toMatchObject({ audience: 'private', readers: '[]', team_id: null, expires_at: null })
    await expect(readHtml(client, id, null, 1, now + 60002)).rejects.toMatchObject({ status: 404 })
  })

  it('does not extend removal grace and permanently purges content while preventing publication replay', async () => {
    const first = await publish()
    const id = String(first.document_id)
    await manageHtml(client, id, owner, 'remove', { expectedVersion: 1 }, now + 1000)
    await manageHtml(client, id, owner, 'remove', { expectedVersion: 1 }, now + 2000)
    expect((await documentRow(client, id)).removed_at).toBe(now + 1000)
    await expect(readHtml(client, id, owner, 1, now + 1000)).rejects.toMatchObject({ status: 410 })
    expect(await purgeHtml(client, now + RECOVERY_MS)).toBe(0)
    expect(await purgeHtml(client, now + 1000 + RECOVERY_MS)).toBe(1)
    expect(await purgeHtml(client, now + 1000 + RECOVERY_MS)).toBe(0)
    expect((await client.execute('SELECT * FROM html_versions')).rows).toHaveLength(0)
    await expect(manageHtml(client, id, owner, 'restore', { lifetime: { permanent: true } }, now + 1000 + RECOVERY_MS)).rejects.toMatchObject({ status: 404 })
    await expect(publish({}, 'first', now + 1000 + RECOVERY_MS)).rejects.toMatchObject({ status: 404 })
    expect((await client.execute('SELECT * FROM html_receipts')).rows).toHaveLength(1)
  })

  it('scopes discovery, tags and roles before pagination, and revokes team-derived history', async () => {
    await client.execute('INSERT INTO teams VALUES (\'team\',\'Fixture team\',NULL,\'owner@example.com\',1,NULL)')
    await client.execute('INSERT INTO team_members VALUES (\'team\',\'owner@example.com\',\'owner\',1),(\'team\',\'reader@example.com\',\'viewer\',1)')
    const first = await publish({ audience: { mode: 'team', teamId: 'team' }, publication: inspectHtml(html, { category: 'Plans', tags: ['Reports', 'consolidation'] }) })
    const id = String(first.document_id)
    await publish({ publication: inspectHtml(html, { category: 'Private', tags: ['hidden'] }) }, 'private')
    expect((await discoverHtml(client, reader, { tags: ['reports', 'consolidation'], category: 'Plans' }, base, now)).items).toHaveLength(1)
    expect((await discoverHtml(client, outsider, {}, base, now)).items).toHaveLength(0)
    expect((await discoverLabels(client, reader, 'tags', '', undefined, undefined, now)).map(item => item.label)).toEqual(['consolidation', 'reports'])
    await expect(publishHtml(client, { documentId: id, expectedVersion: 1, publication: inspectHtml(html) }, 'viewer-write', reader, 'viewer', base, now)).rejects.toMatchObject({ status: 403 })
    await client.execute('DELETE FROM team_members WHERE user_email=\'reader@example.com\'')
    await expect(readHtml(client, id, reader, 1, now)).rejects.toMatchObject({ status: 404 })
    expect(await discoverLabels(client, reader, 'tags', '', undefined, undefined, now)).toEqual([])
  })

  it('retains series publisher binding without granting read or administration rights', async () => {
    await client.execute('INSERT INTO report_series VALUES (\'series\',\'owner@example.com\',\'Fixture\',\'fixture\',\'publisher@example.com\',1,1)')
    const publisher = { subject: owner.subject, actor: 'publisher@example.com', publisherOnly: true }
    const input = { publication: inspectHtml(html), seriesId: 'series' }
    const first = await publishHtml(client, input, JSON.stringify(input), publisher, 'series-first', base, now)
    await expect(readHtml(client, String(first.document_id), publisher, 1, now)).rejects.toMatchObject({ status: 404 })
    await expect(manageHtml(client, String(first.document_id), publisher, 'retention', { lifetime: { permanent: true }, expectedRetentionRevision: 1 }, now)).rejects.toMatchObject({ status: 403 })
    await client.execute('UPDATE report_series SET publisher=NULL WHERE id=\'series\'')
    await expect(publishHtml(client, input, JSON.stringify(input), publisher, 'series-first', base, now)).rejects.toMatchObject({ status: 403 })
    expect(await row(client, 'SELECT COUNT(*) AS count FROM html_versions')).toMatchObject({ count: 1 })
  })
})

describe('HTML boundary validation', () => {
  it('reads inert metadata, applies explicit overrides and preserves the original file', () => {
    const input = html.replace('</head>', '<script type="application/json" id="openape-report">{"category":"Plans","tags":[" REPORTS ","reports"],"metadata":{"plans.status":"draft"}}</script></head>')
    expect(inspectHtml(input, { title: 'Override' })).toMatchObject({ html: input, title: 'Override', category: 'Plans', tags: ['reports'], metadata: { 'plans.status': 'draft' } })
    expect(inspectHtml(html.replace('<p>12</p>', '<img src="https://images.example.test/a.png">'))).toMatchObject({ externalImages: ['https://images.example.test/a.png'] })
  })
  it('rejects misleading MIME declarations and bounded-resource overflows before storage', () => {
    const misleading = Buffer.from('<html><script>alert(1)</script></html>').toString('base64')
    expect(() => inspectHtml(html.replace('<p>12</p>', `<img src="data:image/png;base64,${misleading}">`))).toThrow('do not match image/png')
    const oversized = Buffer.alloc(EMBEDDED_RESOURCE_LIMIT + 1).toString('base64')
    expect(() => inspectHtml(html.replace('<p>12</p>', `<img src="data:image/png;base64,${oversized}">`))).toThrow('exceeds 8 MiB')
    expect(() => inspectHtml(`${html}${' '.repeat(HTML_LIMIT)}`)).toThrow('20 MiB')
    expect(() => lifetime({ expiresAt: '2027-02-30T12:00:00Z' }, now)).toThrow('invalid calendar')
  })
  it('rejects unsupported local dependencies, active metadata and conflicting lifetime input', () => {
    for (const content of ['<img src="./screenshot.png">', '<script src="https://cdn.example.test/a.js"></script>', '<link href="style.css" rel="stylesheet">', '<iframe src="https://example.test"></iframe>', '<script id="openape-report" type="application/json">{"readers":["other@example.com"]}</script>']) expect(() => inspectHtml(html.replace('<p>12</p>', content))).toThrow()
    expect(() => lifetime({ permanent: true, expiresIn: '1d' }, now)).toThrow()
    expect(() => lifetime({ expiresAt: '2026-10-07T12:00:00' }, now)).toThrow()
    expect(() => lifetime({ expiresAt: '2026-10-05T12:00:00Z' }, now)).toThrow()
  })
})

describe('backup restore policy reconciliation', () => {
  async function backup() {
    await client.execute({ sql: 'VACUUM INTO ?', args: [join(directory, 'backup.db')] })
  }
  function restoreDatabase() {
    client.close()
    for (const suffix of ['', '-wal', '-shm']) rmSync(join(directory, `reports.db${suffix}`), { force: true })
    copyFileSync(join(directory, 'backup.db'), join(directory, 'reports.db'))
    client = createClient({ url: `file:${join(directory, 'reports.db')}` })
  }
  it('reapplies revocation, expiry, team removal and purge before serving an older backup', async () => {
    const journal = join(directory, 'current-policy.json')
    await initializeHtmlPolicyJournal(client, journal)
    const revoked = String((await publish({ audience: { mode: 'public' } }, 'revoked')).document_id)
    const expired = String((await publish({ audience: { mode: 'public' } }, 'expired')).document_id)
    const purged = String((await publish({ audience: { mode: 'public' } }, 'purged')).document_id)
    await transaction(client, async (tx) => {
      await tx.execute('INSERT INTO report_series VALUES (\'series\',\'owner@example.com\',\'Fixture\',\'fixture\',\'publisher@example.com\',1,1)')
      await tx.execute('INSERT INTO teams VALUES (\'team\',\'Fixture\',NULL,\'owner@example.com\',1,NULL)')
      await tx.execute('INSERT INTO team_members VALUES (\'team\',\'owner@example.com\',\'owner\',1),(\'team\',\'reader@example.com\',\'viewer\',1)')
    })
    const team = String((await publish({ audience: { mode: 'team', teamId: 'team' } }, 'team')).document_id)
    await backup()
    await manageHtml(client, revoked, owner, 'access', { audience: { mode: 'private' }, expectedAccessRevision: 1 }, now)
    await manageHtml(client, expired, owner, 'retention', { lifetime: { expiresIn: '1m' }, expectedRetentionRevision: 1 }, now)
    await manageHtml(client, purged, owner, 'remove', { expectedVersion: 1 }, now)
    await purgeHtml(client, now + RECOVERY_MS)
    await transaction(client, async (tx) => {
      await tx.execute('DELETE FROM team_members WHERE user_email=\'reader@example.com\'')
      await tx.execute('UPDATE report_series SET publisher=NULL,revision=2 WHERE id=\'series\'')
    })
    restoreDatabase()
    await initializeHtmlPolicyJournal(client, journal)
    expect(await row(client, 'SELECT publisher,revision FROM report_series WHERE id=\'series\'')).toMatchObject({ publisher: null, revision: 2 })
    await expect(readHtml(client, revoked, null, 1, now + 60000)).rejects.toMatchObject({ status: 404 })
    await expect(readHtml(client, expired, null, 1, now + 60000)).rejects.toMatchObject({ status: 410 })
    await expect(readHtml(client, team, reader, 1, now + 60000)).rejects.toMatchObject({ status: 404 })
    await expect(readHtml(client, purged, owner, 1, now + RECOVERY_MS)).rejects.toMatchObject({ status: 404 })
    expect((await client.execute({ sql: 'SELECT * FROM html_versions WHERE document_id=?', args: [purged] })).rows).toEqual([])
    expect(JSON.parse(String((await row(client, 'SELECT receipt FROM html_receipts WHERE document_id=?', [purged]))!.receipt))).toEqual({ document_id: purged, purged: true })
  })
  it('refuses a missing current journal and backups missing newer immutable content', async () => {
    const journal = join(directory, 'current-policy.json')
    await initializeHtmlPolicyJournal(client, journal)
    const id = String((await publish()).document_id)
    await backup()
    await publish({ documentId: id, expectedVersion: 1 }, 'second')
    restoreDatabase()
    await expect(initializeHtmlPolicyJournal(client, journal)).rejects.toThrow('newer immutable versions')
    await expect(initializeHtmlPolicyJournal(client, join(directory, 'missing.json'))).rejects.toThrow('Missing Reports policy journal')
  })
})
