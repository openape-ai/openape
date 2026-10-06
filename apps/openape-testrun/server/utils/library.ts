import type { Client, InValue, Row } from '@libsql/client'
import type { ReportIdentity } from './html-store'
import type { LibraryItem } from '../../shared/library'
import { invalid, label, metadata, tags } from '../../shared/html-publication'
import { LIBRARY_ACCESS } from '../../shared/library'

export interface LibraryFilter { search?: unknown, category?: unknown, tags?: unknown, team?: unknown, access?: unknown, field?: unknown, value?: unknown, sort?: unknown, limit?: unknown, cursor?: unknown }

// One row shape for both sources. HTML documents use the same access predicate as
// `discoverHtml`; earlier uploads the same as `GET /api/reports` (own, not deleted).
// Earlier uploads store seconds, HTML documents milliseconds.
const UNION = `
  SELECT 'html' AS source, d.id AS id, d.id AS ref, v.title AS title, COALESCE(v.category, 'Uncategorized') AS category, v.tags AS tags, v.metadata AS metadata,
    d.updated_at AS at, d.audience AS audience, d.team_id AS team_id, v.author AS author, NULL AS author_act, d.latest_version AS version, d.expires_at AS expires_at,
    NULL AS status, NULL AS passed, NULL AS failed, lower(v.title || ' ' || v.tags || ' ' || COALESCE(v.author, '')) AS haystack
  FROM html_documents d JOIN html_versions v ON v.document_id = d.id AND v.version = d.latest_version
  WHERE d.purged_at IS NULL AND d.removed_at IS NULL AND (d.expires_at IS NULL OR d.expires_at > ?)
    AND (d.owner = ? OR (d.audience = 'readers' AND EXISTS(SELECT 1 FROM json_each(d.readers) WHERE value = ?)) OR (d.audience = 'team' AND EXISTS(SELECT 1 FROM team_members m WHERE m.team_id = d.team_id AND m.user_email = ?)))
  UNION ALL
  SELECT 'upload', r.id, r.slug, r.title,
    CASE WHEN r.report_type = 'briefing' THEN 'Briefings' WHEN r.report_type = 'test' THEN 'Test Runs' ELSE COALESCE(p.category, 'Uncategorized') END,
    '[]', '{}', r.created_at * 1000, CASE WHEN r.visibility = 'shared' THEN 'link' ELSE 'private' END, NULL, r.created_by, r.created_by_act, r.version, NULL,
    r.status, r.passed_count, r.failed_count, lower(r.title || ' ' || COALESCE(r.project, ''))
  FROM runs r LEFT JOIN document_publications p ON p.id = r.id
  WHERE r.created_by = ? AND r.deleted_at IS NULL`
const unionArgs = (identity: ReportIdentity, now: number): InValue[] => [now, identity.subject, identity.subject, identity.subject, identity.subject]

function text(value: unknown, maximum: number, name: string) {
  return value === undefined || value === '' ? undefined : label(value, maximum, name)
}
function decodeCursor(value: unknown, sort: 'updated' | 'title'): [number | string, string] | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^[\w-]{1,1000}$/u.test(value)) invalid('Invalid cursor')
  let decoded: unknown
  try { decoded = JSON.parse(Buffer.from(value, 'base64url').toString()) }
  catch { invalid('Invalid cursor') }
  if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[1] !== 'string' || (sort === 'title' ? typeof decoded[0] !== 'string' : typeof decoded[0] !== 'number')) invalid('Invalid cursor')
  return decoded as [number | string, string]
}
const encodeCursor = (key: number | string, id: string) => Buffer.from(JSON.stringify([key, id])).toString('base64url')

function conditions(filter: LibraryFilter) {
  const where: string[] = []; const args: InValue[] = []
  const search = text(filter.search, 300, 'search')
  if (search) { where.push('instr(u.haystack, ?) > 0'); args.push(search.toLowerCase()) }
  const category = text(filter.category, 80, 'category')
  if (category) { where.push('u.category = ?'); args.push(category) }
  for (const tag of tags(filter.tags === undefined ? [] : [filter.tags].flat())) { where.push('EXISTS(SELECT 1 FROM json_each(u.tags) WHERE value = ?)'); args.push(tag) }
  const team = text(filter.team, 64, 'team')
  if (team) { where.push('u.team_id = ?'); args.push(team) }
  if (filter.access !== undefined && filter.access !== '') {
    if (!LIBRARY_ACCESS.includes(filter.access as typeof LIBRARY_ACCESS[number])) invalid('Unknown access filter')
    where.push('u.audience = ?'); args.push(filter.access as string)
  }
  if (filter.field || filter.value) {
    if (!filter.field || !filter.value) invalid('Publisher data needs a field and a value')
    for (const [key, value] of Object.entries(metadata({ [String(filter.field)]: filter.value }))) { where.push('EXISTS(SELECT 1 FROM json_each(u.metadata) WHERE key = ? AND value = ?)'); args.push(key, value) }
  }
  return { where, args, category }
}

function item(row: Row): LibraryItem {
  const html = row.source === 'html'
  const meta = JSON.parse(String(row.metadata)) as Record<string, string>
  return {
    source: html ? 'html' : 'upload',
    id: String(row.id),
    href: html ? `/d/${row.id}` : `/r/${row.ref}`,
    title: String(row.title),
    category: String(row.category),
    tags: JSON.parse(String(row.tags)),
    at: Number(row.at),
    audience: row.audience as LibraryItem['audience'],
    team_id: row.team_id === null ? null : String(row.team_id),
    author: String(row.author ?? ''),
    author_type: html ? null : row.author_act === 'agent' ? 'agent' : 'person',
    version: Number(row.version),
    expires_at: row.expires_at === null ? null : Number(row.expires_at),
    plan_status: meta['plans.status'] ?? null,
    test_result: html || row.status === null ? null : { status: String(row.status), passed: Number(row.passed), failed: Number(row.failed) },
  }
}

export async function discoverLibrary(client: Pick<Client, 'execute'>, identity: ReportIdentity, filter: LibraryFilter, now = Date.now()) {
  const limit = filter.limit === undefined ? 50 : Number(filter.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid('limit must be between 1 and 100')
  if (filter.sort !== undefined && filter.sort !== 'updated' && filter.sort !== 'title') invalid('sort must be updated or title')
  const sort = filter.sort === 'title' ? 'title' : 'updated'
  const cursor = decodeCursor(filter.cursor, sort)
  const { where, args, category } = conditions(filter)
  const base = unionArgs(identity, now)
  const key = sort === 'title' ? 'u.t' : 'u.at'
  const page = [...where]; const pageArgs = [...args]
  if (cursor) {
    page.push(sort === 'title' ? `(${key} > ? OR (${key} = ? AND u.k > ?))` : `(${key} < ? OR (${key} = ? AND u.k < ?))`)
    pageArgs.push(cursor[0], cursor[0], cursor[1])
  }
  const order = sort === 'title' ? `${key} ASC, u.k ASC` : `${key} DESC, u.k DESC`
  const filtered = (clauses: string[]) => `SELECT u.*, u.source || ':' || u.id AS k, lower(u.title) AS t FROM (${UNION}) u${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}`
  const rows = (await client.execute({ sql: `SELECT * FROM (${filtered([])}) u${page.length ? ` WHERE ${page.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ?`, args: [...base, ...pageArgs, limit + 1] })).rows
  const items = rows.slice(0, limit).map(item)
  const last = rows.length > limit ? rows[limit - 1]! : null
  const next_cursor = last ? encodeCursor(sort === 'title' ? String(last.t) : Number(last.at), String(last.k)) : null
  if (cursor) return { items, next_cursor }

  const [total, categories, tagCounts] = await Promise.all([
    client.execute({ sql: `SELECT count(*) AS n FROM (${filtered(where)})`, args: [...base, ...args] }),
    client.execute({ sql: `SELECT u.category AS label, count(*) AS count FROM (${UNION}) u GROUP BY u.category ORDER BY u.category`, args: base }),
    client.execute({ sql: `SELECT j.value AS label, count(*) AS count FROM (${UNION}) u, json_each(u.tags) j${category ? ' WHERE u.category = ?' : ''} GROUP BY j.value ORDER BY count(*) DESC, j.value LIMIT 14`, args: category ? [...base, category] : base }),
  ])
  const counts = categories.rows.map(row => ({ label: String(row.label), count: Number(row.count) }))
  return {
    items,
    next_cursor,
    facets: {
      total: Number(total.rows[0]!.n),
      all: counts.reduce((sum, row) => sum + row.count, 0),
      categories: counts,
      tags: tagCounts.rows.map(row => ({ label: String(row.label), count: Number(row.count) })),
    },
  }
}
