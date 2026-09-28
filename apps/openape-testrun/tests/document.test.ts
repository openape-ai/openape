import { mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateReports } from '../server/database/migrate'
import { validateDocument, reportCategory } from '../server/utils/document-shape'
import { sanitizeDocument, sanitizeDocumentCss } from '../server/utils/document-sanitizer'
import { publishDocument } from '../server/utils/document-store'
import { createReportSeries } from '../server/utils/report-store'

const input = { type: 'document', schemaVersion: 1, title: 'Review', html: '<h1>Hello</h1>', category: 'Custom category' }
let client: ReturnType<typeof createClient> | undefined
let directory: string | undefined
afterEach(() => { client?.close(); if (directory) rmSync(directory, { recursive: true }); directory = undefined })

describe('immutable document publication', () => {
  it('publishes concurrent same-day editions, replays exact bytes, and preserves stored sanitization', async () => {
    directory = mkdtempSync(join(tmpdir(), 'document-'))
    client = createClient({ url: `file:${join(directory, 'reports.db')}` })
    await migrateReports(client)
    const series = await createReportSeries(client, 'owner@example.com', 'PR updates')
    await client.execute({ sql: 'UPDATE report_series SET publisher = ? WHERE id = ?', args: ['publisher@example.com', series.id!] })
    const document = validateDocument({ ...input, seriesId: series.id })
    const raw = JSON.stringify(document)
    const publish = (key: string, body = raw) => publishDocument(client!, document, body, 'owner@example.com', 'publisher@example.com', key)
    const [first, replay, second] = await Promise.all([publish('first'), publish('first'), publish('second')])
    expect(replay).toEqual({ ...first, replayed: true })
    expect(second.id).not.toBe(first.id); expect(second.slug).not.toBe(first.slug); expect(second.version).toBe(2)
    expect(first.digest).toBe(createHash('sha256').update(raw).digest('hex'))
    expect(first.artifactDigest).not.toBe(first.digest)
    await expect(publish('first', `${raw} `)).rejects.toMatchObject({ statusCode: 409 })
    await client.execute('UPDATE document_publications SET policy_version = \'prior-policy\' WHERE idempotency_key = \'first\'')
    expect((await publish('first')).policyVersion).toBe('prior-policy')
    expect((await client.execute('SELECT count(*) AS count FROM runs')).rows[0]!.count).toBe(2)
    await migrateReports(client)
    expect((await client.execute('SELECT count(*) AS count FROM document_publications')).rows[0]!.count).toBe(2)
    await client.execute('UPDATE report_series SET publisher = NULL')
    await expect(publish('third')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rolls back report rows when receipt persistence fails', async () => {
    directory = mkdtempSync(join(tmpdir(), 'document-rollback-'))
    client = createClient({ url: `file:${join(directory, 'reports.db')}` })
    await migrateReports(client)
    await client.execute('CREATE TRIGGER reject_document BEFORE INSERT ON document_publications BEGIN SELECT RAISE(ABORT, \'injected failure\'); END')
    await expect(publishDocument(client, validateDocument(input), JSON.stringify(input), 'owner', 'owner', 'key')).rejects.toThrow('injected failure')
    expect((await client.execute('SELECT * FROM runs')).rows).toHaveLength(0)
  })
})

describe('document trust boundary', () => {
  it('normalizes categories without imposing a business enum', () => {
    expect(reportCategory('  Cafe\u0301  ')).toEqual(reportCategory('Café'))
    expect(reportCategory('CUSTOM').key).toBe(reportCategory('custom').key)
    expect(validateDocument(input).category).toBe('Custom category')
  })
  it.each([{ schemaVersion: 2 }, { owner: 'other' }, { visibility: 'shared' }, { html: '' }, { category: 'bad\nlabel' }, { language: '" onload="x' }, { assets: [{ name: 'x.svg', contentType: 'image/svg+xml', data: 'PHN2Zz4=' }] }])('rejects invalid envelopes %j', (changes) => {
    expect(() => validateDocument({ ...input, ...changes })).toThrow()
  })
  it('removes active HTML, navigation, namespace content, clobbering and external loads', () => {
    const document = validateDocument({ ...input, html: '<script>alert(1)</script><img src="https://attacker.invalid/x" onerror="alert(1)"><svg><a onload="x">bad</a></svg><form id="location"><input name="href"></form><base href="https://attacker.invalid"><meta http-equiv="refresh" content="0;url=https://attacker.invalid"><a href="&#106;avascript:alert(1)">Link</a><p id="cookie" style="position:fixed">Safe</p>' })
    const result = sanitizeDocument(document)
    for (const bad of ['<script', 'onerror', '<svg', '<form', '<input', '<base', 'http-equiv', 'javascript:', 'https://attacker', 'id="cookie"', 'position:fixed']) expect(result.artifact).not.toContain(bad)
    expect(result.artifact).toContain('<p>Safe</p>')
  })
  it('retains responsive client CSS while removing fetching and executable declarations', () => {
    const css = sanitizeDocumentCss('@import "https://attacker.invalid"; @font-face{src:url(https://attacker.invalid)}body{background:url(https://attacker.invalid);color:red;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:expression(alert(1))}@media(max-width:600px){body{display:block}}')
    expect(css).not.toContain('attacker'); expect(css).not.toContain('expression'); expect(css).toContain('repeat(2,minmax(0,1fr))'); expect(css).toContain('@media')
    expect(() => sanitizeDocumentCss('body{background:u\\72l(x)}')).toThrow()
    expect(() => sanitizeDocumentCss('</style><script>alert(1)</script>')).toThrow()
  })
})
