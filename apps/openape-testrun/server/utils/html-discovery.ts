import type { Client, InValue, Row } from '@libsql/client'
import type { HtmlDocumentRow, ReportIdentity } from './html-store'
import { invalid, label, metadata, RECOVERY_MS, tags } from '../../shared/html-publication'
import { removedAt } from './html-store'

export interface Discovery { search?: string, category?: string, tags?: string[], metadata?: Record<string, string>, team?: string, series?: string, deleted?: boolean, limit?: number, cursor?: string }
export function pagination(limit: unknown, cursor: unknown) {
  const count = limit === undefined ? 20 : Number(limit)
  if (!Number.isInteger(count) || count < 1 || count > 100) invalid('limit must be between 1 and 100')
  let offset = 0
  if (cursor !== undefined) {
    if (typeof cursor !== 'string' || !/^[\w-]+$/iu.test(cursor)) invalid('Invalid cursor')
    const decoded = Buffer.from(cursor, 'base64url').toString()
    if (!/^\d{1,9}$/u.test(decoded)) invalid('Invalid cursor')
    offset = Number(decoded)
  }
  return { limit: count, offset }
}
export function page<T>(items: T[], limit: number, offset: number) {
  return { items: items.slice(0, limit), next_cursor: items.length > limit ? Buffer.from(String(offset + limit)).toString('base64url') : null }
}
export function versionMetadata(version: Row) {
  return { publication_id: version.id, version: Number(version.version), title: String(version.title), category: version.category, language: version.language, tags: JSON.parse(String(version.tags)), metadata: JSON.parse(String(version.metadata)), author: version.author, created_at: version.created_at, artifact_digest: version.artifact_digest, policy_version: version.policy_version, external_images: JSON.parse(String(version.external_images)), external_links: JSON.parse(String(version.external_links)) }
}
export async function discoverHtml(client: Client, identity: ReportIdentity, filter: Discovery, base: string, now = Date.now()) {
  const { limit, offset } = pagination(filter.limit, filter.cursor)
  const conditions = ['d.purged_at IS NULL', '(d.owner=? OR (d.audience=\'readers\' AND EXISTS(SELECT 1 FROM json_each(d.readers) WHERE value=?)) OR (d.audience=\'team\' AND EXISTS(SELECT 1 FROM team_members m WHERE m.team_id=d.team_id AND m.user_email=?)))']
  const args: InValue[] = [identity.subject, identity.subject, identity.subject]
  if (filter.deleted) {
    conditions.push('d.owner=?', '((d.removed_at IS NOT NULL AND d.removed_at<=?) OR (d.expires_at IS NOT NULL AND d.expires_at<=?))', '(d.removed_at IS NULL OR d.removed_at>?)', '(d.expires_at IS NULL OR d.expires_at>?)')
    args.push(identity.subject, now, now, now - RECOVERY_MS, now - RECOVERY_MS)
  }
  else { conditions.push('d.removed_at IS NULL', '(d.expires_at IS NULL OR d.expires_at>?)'); args.push(now) }
  if (filter.search) { conditions.push('instr(lower(v.title),lower(?))>0'); args.push(label(filter.search, 300, 'search')) }
  if (filter.category) { conditions.push('v.category=?'); args.push(label(filter.category, 80, 'category')) }
  if (filter.team) { conditions.push('d.team_id=?'); args.push(filter.team) }
  if (filter.series) { conditions.push('d.series_id=?'); args.push(filter.series) }
  for (const tag of tags(filter.tags ?? [])) { conditions.push('EXISTS(SELECT 1 FROM json_each(v.tags) WHERE value=?)'); args.push(tag) }
  for (const [key, value] of Object.entries(metadata(filter.metadata ?? {}))) { conditions.push('EXISTS(SELECT 1 FROM json_each(v.metadata) WHERE key=? AND value=?)'); args.push(key, value) }
  const result = await client.execute({ sql: `SELECT d.*,v.id AS publication_id,v.version,v.title,v.category,v.language,v.tags,v.metadata,v.author FROM html_documents d JOIN html_versions v ON v.document_id=d.id AND v.version=d.latest_version WHERE ${conditions.join(' AND ')} ORDER BY d.updated_at DESC,d.id DESC LIMIT ? OFFSET ?`, args: [...args, limit + 1, offset] })
  const items = result.rows.map((item) => {
    const removed = filter.deleted ? removedAt(item as unknown as HtmlDocumentRow, now) : null
    return { ...item, tags: JSON.parse(String(item.tags)), metadata: JSON.parse(String(item.metadata)), readers: undefined, url: `${base}/d/${item.id}`, version_url: `${base}/d/${item.id}?v=${item.version}`, ...(filter.deleted ? { unavailable_at: removed!, purge_at: removed! + RECOVERY_MS } : {}) }
  })
  return page(items, limit, offset)
}
export async function discoverLabels(client: Client, identity: ReportIdentity, kind: 'tags' | 'categories', search: string, team: string | undefined, category: string | undefined, now = Date.now()) {
  const source = kind === 'tags' ? 'JOIN json_each(v.tags) j' : ''
  const field = kind === 'tags' ? 'j.value' : 'v.category'
  const result = await client.execute({ sql: `SELECT ${field} AS label,count(DISTINCT d.id) AS count FROM html_documents d JOIN html_versions v ON v.document_id=d.id AND v.version=d.latest_version ${source}
    WHERE d.purged_at IS NULL AND d.removed_at IS NULL AND (d.expires_at IS NULL OR d.expires_at>?) AND (d.owner=? OR (d.audience='readers' AND EXISTS(SELECT 1 FROM json_each(d.readers) WHERE value=?)) OR (d.audience='team' AND EXISTS(SELECT 1 FROM team_members m WHERE m.team_id=d.team_id AND m.user_email=?)))
    AND ${field} IS NOT NULL AND instr(lower(${field}),lower(?))>0 AND (? IS NULL OR d.team_id=?) AND (? IS NULL OR v.category=?) GROUP BY ${field} ORDER BY ${field}`, args: [now, identity.subject, identity.subject, identity.subject, search, team ?? null, team ?? null, category ?? null, category ?? null] })
  return result.rows
}
