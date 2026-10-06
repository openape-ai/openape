import type { H3Event } from 'h3'
import type { HtmlMetadata } from '../../shared/html-publication'
import type { ReportIdentity } from './html-store'
import { createError, getHeader, getMethod, getQuery, getRequestURL, setHeader, setResponseStatus } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { HTML_LIMIT, ReportError, inspectHtml, invalid, object } from '../../shared/html-publication'
import { useDatabaseClient } from '../database/drizzle'
import { privateReportHeaders, reportOwner, reportPublisher, verifyReportPublisher } from './report-auth'
import { limitReportRequests, readReportBody } from './report-request'
import { discoverHtml, discoverLabels, page, pagination, versionMetadata } from './html-discovery'
import { assertLive, documentRow, manageHtml, publishHtml, readHtml, removedAt, role, row } from './html-store'
import { issueHtmlCapability } from './html-capability'

export function htmlBase(event: H3Event) {
  return String(useRuntimeConfig().briefingUrl || useRuntimeConfig().publicUrl || getRequestURL(event).origin).replace(/\/$/u, '')
}
export async function optionalReportIdentity(event: H3Event): Promise<ReportIdentity | null> {
  if (!getHeader(event, 'authorization') && !getHeader(event, 'cookie')) return null
  try { return await reportOwner(event) }
  catch (error) { if ((error as { statusCode?: number }).statusCode === 401) return null; throw error }
}
function revision(value: unknown) {
  if (value === undefined) return undefined
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) invalid('revision must be a positive integer')
  return number
}
export function htmlProblem(error: unknown): never {
  if (error instanceof ReportError) throw createError({ statusCode: error.status, statusMessage: error.message, data: { code: error.code, message: error.message } })
  throw error
}
function queryJson(value: unknown, fallback: unknown) {
  if (value === undefined) return fallback
  if (typeof value !== 'string') invalid('Invalid query field')
  try { return JSON.parse(value) }
  catch { invalid('Query field must contain JSON') }
}
async function htmlReceipt(event: H3Event, key: string) {
  const db = useDatabaseClient()
  let identity: ReportIdentity
  try { identity = await reportOwner(event) }
  catch (error) {
    if ((error as { statusCode?: number }).statusCode !== 401) throw error
    const authorization = getHeader(event, 'authorization') ?? ''
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
    const subject = token ? unsafeDecodeSub(token) : null
    if (!subject) throw error
    const actor = await verifyReportPublisher(token, subject)
    const candidates = (await db.execute({ sql: 'SELECT r.* FROM html_receipts r JOIN html_documents d ON d.id=r.document_id JOIN report_series s ON s.id=d.series_id WHERE r.actor=? AND r.key=? AND s.publisher=? AND s.owner=d.owner LIMIT 2', args: [actor, key, actor] })).rows
    if (candidates.length !== 1) throw new ReportError(candidates.length ? 'CONFLICT' : 'NOT_FOUND', candidates.length ? 'This publisher key is ambiguous across owners; reconcile the document before retrying' : 'Publication receipt unavailable or publisher revoked', candidates.length ? 409 : 404)
    const receipt = candidates[0]!
    const current = await documentRow(db, String(receipt.document_id)); assertLive(current, Date.now())
    return JSON.parse(String(receipt.receipt))
  }
  const receipt = await row(db, 'SELECT * FROM html_receipts WHERE identity=? AND actor=? AND key=?', [identity.subject, identity.actor, key])
  if (!receipt) throw new ReportError('NOT_FOUND', 'Publication receipt not found', 404)
  const current = await documentRow(db, String(receipt.document_id))
  assertLive(current, Date.now())
  if (!await role(db, current, identity)) throw new ReportError('FORBIDDEN', 'Publication access was revoked', 403)
  return JSON.parse(String(receipt.receipt))
}
async function handleHtml(event: H3Event, parts: string[]) {
  privateReportHeaders(event)
  limitReportRequests(event)
  const db = useDatabaseClient(); const query = getQuery(event); const method = getMethod(event); const base = htmlBase(event)
  const [id, action] = parts
  if (!['GET', 'HEAD'].includes(method) && action !== 'viewer' && String(useRuntimeConfig().htmlWritesFrozen) === 'true') throw new ReportError('UNAVAILABLE', 'Report writes are frozen for reconciliation', 503)
  if (parts.length > 2) invalid('Unknown document route')
  if (method === 'GET' && (!id || ['categories', 'tags', 'teams', 'receipt'].includes(id))) {
    if (id === 'receipt') return htmlReceipt(event, String(query.key ?? ''))
    const identity = await reportOwner(event)
    const bounds = pagination(query.limit, query.cursor)
    if (id === 'teams') {
      const result = await db.execute({ sql: 'SELECT t.*,m.role FROM teams t JOIN team_members m ON m.team_id=t.id WHERE m.user_email=? ORDER BY t.name,t.id LIMIT ? OFFSET ?', args: [identity.subject, bounds.limit + 1, bounds.offset] })
      return page(result.rows, bounds.limit, bounds.offset)
    }
    if (id === 'tags' || id === 'categories') return page((await discoverLabels(db, identity, id, String(query.search ?? ''), query.team as string | undefined, query.category as string | undefined)).slice(bounds.offset), bounds.limit, bounds.offset)
    return discoverHtml(db, identity, { search: query.search as string | undefined, category: query.category as string | undefined, team: query.team as string | undefined, series: query.series as string | undefined, tags: queryJson(query.tags, []), metadata: queryJson(query.metadata, {}), deleted: query.deleted === 'true', limit: bounds.limit, cursor: query.cursor as string | undefined }, base)
  }
  if (method === 'POST' && !id) {
    if (String(useRuntimeConfig().htmlPublishingEnabled) !== 'true') throw new ReportError('UNAVAILABLE', 'HTML publication is disabled', 503)
    const { raw, data } = await readReportBody(event, HTML_LIMIT * 2)
    const body = object(data, ['schemaVersion', 'html', 'metadata', 'documentId', 'expectedVersion', 'seriesId', 'audience', 'lifetime'])
    if (body.schemaVersion !== 2 || typeof body.html !== 'string') invalid('schemaVersion 2 and one HTML string are required')
    let identity: ReportIdentity
    const boundSeries = typeof body.seriesId === 'string' ? body.seriesId : typeof body.documentId === 'string' ? (await documentRow(db, body.documentId)).series_id : null
    if (boundSeries) {
      const series = await row(db, 'SELECT * FROM report_series WHERE id=?', [boundSeries])
      if (!series) throw new ReportError('NOT_FOUND', 'Series not found', 404)
      const publisher = await reportPublisher(event, { owner: String(series.owner), publisher: series.publisher === null ? null : String(series.publisher) })
      identity = { subject: String(series.owner), actor: publisher, publisherOnly: publisher !== series.owner }
    }
    else {
      identity = await reportOwner(event, 'reports:publish')
    }
    const publication = inspectHtml(body.html, body.metadata as Partial<HtmlMetadata> | undefined)
    const result = await publishHtml(db, { publication, documentId: body.documentId as string | undefined, expectedVersion: body.expectedVersion as number | undefined, seriesId: body.seriesId as string | undefined, audience: body.audience, lifetime: body.lifetime }, raw, identity, getHeader(event, 'idempotency-key') ?? '', base)
    setResponseStatus(event, result.replayed ? 200 : 201)
    return result
  }
  if (!id) invalid('Unknown document operation')
  if (method === 'GET' && ['access', 'retention'].includes(action ?? '')) {
    const identity = await reportOwner(event)
    const document = await documentRow(db, id)
    const callerRole = await role(db, document, identity)
    if (!['owner', 'admin'].includes(callerRole ?? '')) throw new ReportError('FORBIDDEN', 'Owner or administrator required', 403)
    const removed = removedAt(document, Date.now())
    return { document_id: document.id, audience: document.audience, readers: JSON.parse(String(document.readers)), team_id: document.team_id, access_revision: document.access_revision, retention_revision: document.retention_revision, expires_at: document.expires_at, removed_at: removed, purge_at: removed === null ? null : removed + 30 * 86400000, lifecycle: removed === null ? 'active' : 'recoverable', caller_role: callerRole }
  }
  if (method === 'GET') {
    const identity = await optionalReportIdentity(event)
    const { document, version, callerRole } = await readHtml(db, id, identity, revision(query.revision))
    if (action === 'html') {
      setHeader(event, 'content-type', 'text/html; charset=utf-8')
      setHeader(event, 'content-disposition', `attachment; filename="report-${document.id}-v${version.version}.html"`)
      setHeader(event, 'content-security-policy', 'default-src \'none\'; sandbox')
      setHeader(event, 'x-content-type-options', 'nosniff')
      return String(version.html)
    }
    if (action === 'history') {
      const bounds = pagination(query.limit, query.cursor)
      const versions = await db.execute({ sql: 'SELECT id,version,title,author,created_at,artifact_digest FROM html_versions WHERE document_id=? ORDER BY version DESC LIMIT ? OFFSET ?', args: [document.id, bounds.limit + 1, bounds.offset] })
      return page(versions.rows.map(item => ({ ...item, version_url: `${base}/d/${document.id}?v=${item.version}` })), bounds.limit, bounds.offset)
    }
    if (action) invalid('Unknown document read operation')
    return { document_id: document.id, ...versionMetadata(version), latest_version: document.latest_version, audience: document.audience, team_id: document.team_id, expires_at: document.expires_at, access_revision: document.access_revision, retention_revision: document.retention_revision, caller_role: callerRole, url: `${base}/d/${document.id}`, version_url: `${base}/d/${document.id}?v=${version.version}`, legacy_plan_id: document.legacy_plan_id }
  }
  if (method === 'POST' && action === 'viewer') {
    const identity = await optionalReportIdentity(event)
    if (getHeader(event, 'origin') !== getRequestURL(event).origin) throw new ReportError('FORBIDDEN', 'Matching viewer Origin required', 403)
    const { document, version } = await readHtml(db, id, identity, revision(query.revision))
    const origin = String(useRuntimeConfig().htmlContentOrigin)
    if (!origin || new URL(origin).origin === getRequestURL(event).origin) throw new ReportError('UNAVAILABLE', 'An isolated content origin is required', 503)
    const capability = issueHtmlCapability({ viewerOrigin: getRequestURL(event).origin, identity, documentId: String(document.id), version: Number(version.version), accessRevision: Number(document.access_revision), retentionRevision: Number(document.retention_revision) })
    return { url: `${origin}/content/${capability}`, expires_in: 60 }
  }
  const identity = await reportOwner(event, method === 'PATCH' && !action ? 'reports:publish' : 'reports:manage')
  const { raw, data } = await readReportBody(event, 65536)
  if (method === 'PATCH' && !action) {
    if (String(useRuntimeConfig().htmlPublishingEnabled) !== 'true') throw new ReportError('UNAVAILABLE', 'HTML publication is disabled', 503)
    const body = object(data, ['expectedVersion', 'changes'])
    const changes = object(body.changes, ['title', 'language', 'category', 'tags', 'metadata'])
    if (!Object.keys(changes).length) invalid('At least one metadata change is required')
    return publishHtml(db, { documentId: id, expectedVersion: body.expectedVersion as number, changes: changes as Partial<HtmlMetadata> }, raw, identity, getHeader(event, 'idempotency-key') ?? '', base)
  }
  if (method === 'DELETE' && !action) return manageHtml(db, id, identity, 'remove', data)
  if (method === 'POST' && ['access', 'retention', 'restore'].includes(action ?? '')) return manageHtml(db, id, identity, String(action), data)
  invalid('Unknown document mutation')
}
export async function htmlApi(event: H3Event, parts: string[] = []) {
  try { return await handleHtml(event, parts) }
  catch (error) { htmlProblem(error) }
}
