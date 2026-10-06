import type { Client, Row, Transaction } from '@libsql/client'
import type { HtmlPublication } from '../../shared/html-publication'
import type { ReportIdentity } from './html-store'
import { ulid } from 'ulid'
import { renderMarkdown } from '@openape/report-contracts/plans-renderer'
import { ReportError, invalid, label, object } from '../../shared/html-publication'
import { assertLive, documentRow, insertVersion, role, row, snapshot, transaction } from './html-store'

const statuses = ['draft', 'active', 'done', 'archived']
export function planPublication(title: string, source: string, status: string, previous?: HtmlPublication): HtmlPublication {
  if (!statuses.includes(status)) invalid('Invalid plan status')
  if (Buffer.byteLength(source) > 20 * 1024 * 1024) invalid('Plan source exceeds 20 MiB')
  const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title><style>body{font:16px/1.65 system-ui,sans-serif;max-width:960px;margin:0 auto;padding:32px;color:#e2e8f0;background:#111827}a{color:#93c5fd}img{max-width:100%;height:auto}pre{overflow:auto;background:#1e293b;padding:16px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #475569;padding:8px;text-align:left}.callout,.card{border:1px solid #475569;border-radius:8px;padding:16px;margin:16px 0}.callout-warn{border-color:#f59e0b}.callout-danger{border-color:#f87171}.callout-success{border-color:#34d399}.badge{display:inline-block;border:1px solid #64748b;border-radius:8px;padding:2px 8px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}.meta{color:#94a3b8}.lead{font-size:1.2em}h1,h2,h3{line-height:1.25}blockquote{border-left:3px solid #64748b;padding-left:16px;margin-left:0}</style></head><body>${renderMarkdown(source)}</body></html>`
  const externalImages = Array.from(html.matchAll(/<img[^>]+src="(https?:[^"\s]+)"/gu), match => match[1]!)
  const externalLinks = Array.from(html.matchAll(/<a[^>]+href="((?:https?:|mailto:)[^"\s]+)"/gu), match => match[1]!)
  return { html, title, language: 'en', category: previous?.category ?? 'Plans', tags: previous?.tags ?? [], metadata: { ...previous?.metadata, 'plans.status': status, 'plans.renderer': 'legacy-markdown/1' }, externalImages, externalLinks }
}
export function planVersion(input: unknown, current: number) {
  if (input === undefined) throw new ReportError('UPGRADE_REQUIRED', 'Upgrade ape-plans and submit expected_version from the plan you read', 428)
  if (!Number.isSafeInteger(input) || input !== current) throw new ReportError('CONFLICT', 'The plan changed; reload and reconcile your source before retrying', 409)
}
export async function member(db: Pick<Client, 'execute'>, team: string, identity: ReportIdentity, edit = false, owner = false) {
  const result = await row(db, 'SELECT m.* FROM team_members m JOIN teams t ON t.id=m.team_id WHERE m.team_id=? AND m.user_email=?', [team, identity.subject])
  if (!result || identity.publisherOnly || (edit && result.role === 'viewer') || (owner && result.role !== 'owner')) throw new ReportError('FORBIDDEN', 'Required team membership or role is missing', 403)
  return result
}
export function planResult(document: Row, version: Row, callerRole?: string | null) {
  return { id: document.legacy_plan_id ?? document.id, team_id: document.team_id, title: version.title, body_md: version.source, status: JSON.parse(String(version.metadata))['plans.status'] ?? 'draft', owner_email: document.owner, created_at: Math.floor(Number(document.created_at) / 1000), updated_at: Math.floor(Number(document.updated_at) / 1000), updated_by: version.author, version: document.latest_version, caller_role: callerRole === 'admin' ? 'owner' : callerRole === 'reader' ? 'viewer' : callerRole }
}
export async function readPlan(db: Pick<Client, 'execute'>, id: string, identity: ReportIdentity, now = Date.now()) {
  const document = await documentRow(db, id)
  if (!document.legacy_plan_id) throw new ReportError('NOT_FOUND', 'Plan not found', 404)
  const callerRole = await role(db, document, identity)
  if (!callerRole) throw new ReportError('NOT_FOUND', 'Plan not found', 404)
  assertLive(document, now)
  const version = await row(db, 'SELECT * FROM html_versions WHERE document_id=? AND version=?', [document.id, document.latest_version])
  if (!version || version.source === null) throw new ReportError('CONFLICT', 'This version is HTML-only; edit with ape-reports', 409)
  return { document, version, callerRole, result: planResult(document, version, callerRole) }
}
export async function writePlan(client: Client, identity: ReportIdentity, input: unknown, location: { id?: string, team?: string }, now = Date.now()) {
  const body = object(input, ['title', 'body_md', 'status', 'expected_version'])
  return transaction(client, async (tx) => {
    if (location.id) {
      const current = await readPlan(tx, location.id, identity, now)
      if (!['owner', 'admin', 'editor'].includes(current.callerRole)) throw new ReportError('FORBIDDEN', 'Viewers cannot edit plans', 403)
      planVersion(body.expected_version, current.document.latest_version)
      if (!['title', 'body_md', 'status'].some(key => key in body)) invalid('No fields to update')
      const title = body.title === undefined ? String(current.version.title) : label(body.title, 200, 'title')
      const source = body.body_md === undefined ? String(current.version.source) : body.body_md
      const status = body.status === undefined ? String(current.result.status) : body.status
      if (typeof source !== 'string' || typeof status !== 'string') invalid('Plan source and status must be strings')
      const publication = planPublication(title, source, status, snapshot(current.version))
      const next = current.document.latest_version + 1
      await insertVersion(tx, current.document.id, next, publication, identity.actor, now, source)
      await tx.execute({ sql: 'UPDATE html_documents SET latest_version=?,updated_at=? WHERE id=?', args: [next, now, current.document.id] })
      return (await readPlan(tx, current.document.id, identity, now)).result
    }
    if (!location.team) invalid('Team is required')
    await member(tx, location.team, identity, true)
    const title = label(body.title, 200, 'title'); const source = body.body_md ?? ''; const status = body.status ?? 'draft'
    if (typeof source !== 'string' || typeof status !== 'string') invalid('Plan source and status must be strings')
    const publication = planPublication(title, source, status); const id = ulid()
    await tx.execute({ sql: 'INSERT INTO html_documents (id,legacy_plan_id,owner,team_id,audience,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', args: [id, id, identity.subject, location.team, 'team', now, now] })
    await insertVersion(tx, id, 1, publication, identity.actor, now, source)
    return (await readPlan(tx, id, identity, now)).result
  })
}
export async function listPlans(db: Pick<Client, 'execute'>, team: string, identity: ReportIdentity, now = Date.now()) {
  await member(db, team, identity)
  const documents = (await db.execute({ sql: 'SELECT * FROM html_documents WHERE team_id=? AND legacy_plan_id IS NOT NULL AND purged_at IS NULL AND removed_at IS NULL AND (expires_at IS NULL OR expires_at>?) ORDER BY updated_at DESC,id', args: [team, now] })).rows
  const result = []
  for (const item of documents) {
    const document = await documentRow(db, String(item.id)); const callerRole = await role(db, document, identity)
    if (!callerRole) continue
    const version = await row(db, 'SELECT * FROM html_versions WHERE document_id=? AND version=?', [document.id, document.latest_version])
    if (version) result.push(planResult(document, version, callerRole))
  }
  return result
}
export async function deletePlan(tx: Transaction, id: string, identity: ReportIdentity, expected: unknown, now: number) {
  const current = await readPlan(tx, id, identity, now)
  if (!['owner', 'admin'].includes(current.callerRole)) throw new ReportError('FORBIDDEN', 'Only plan or team owners may remove plans', 403)
  planVersion(expected, current.document.latest_version)
  await tx.execute({ sql: 'UPDATE html_documents SET removed_at=?,retention_revision=retention_revision+1 WHERE id=?', args: [now, current.document.id] })
  return { ok: true }
}
