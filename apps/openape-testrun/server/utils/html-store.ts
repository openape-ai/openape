import type { Client, InValue, Row, Transaction } from '@libsql/client'
import type { HtmlMetadata, HtmlPublication } from '../../shared/html-publication'
import { createHash } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { ulid } from 'ulid'
import { writeHtmlPolicyJournal } from './html-policy-journal'
import { HTML_POLICY, RECOVERY_MS, ReportError, invalid, label, lifetime, normalizeMetadata, object } from '../../shared/html-publication'

export interface ReportIdentity { subject: string, actor: string, publisherOnly?: boolean }
export interface HtmlDocumentRow extends Row { id: string, owner: string, series_id: string | null, team_id: string | null, audience: string, readers: string, access_revision: number, retention_revision: number, expires_at: number | null, removed_at: number | null, purged_at: number | null, latest_version: number, created_at: number, updated_at: number, legacy_plan_id: string | null }
type Database = Pick<Client, 'execute'> | Transaction
export const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const missing = () => new ReportError('NOT_FOUND', 'Report not found', 404)
const conflict = (message: string) => new ReportError('CONFLICT', message, 409)
const denied = () => new ReportError('FORBIDDEN', 'This operation requires owner or team administrator access', 403)

export async function row(db: Database, sql: string, args: InValue[] = []) { return (await db.execute({ sql, args })).rows[0] }
export function removedAt(document: HtmlDocumentRow, now: number) {
  const times = [document.removed_at, document.expires_at].filter(value => value !== null && Number(value) <= now).map(Number)
  return times.length ? Math.min(...times) : null
}
export function assertLive(document: HtmlDocumentRow, now: number) {
  if (document.purged_at !== null || removedAt(document, now) !== null) throw new ReportError('GONE', 'Report expired or removed; an explicit private restore is required', 410)
}
export async function documentRow(db: Database, id: string) {
  const document = await row(db, 'SELECT * FROM html_documents WHERE id = ? OR legacy_plan_id = ?', [id, id])
  if (!document || document.purged_at !== null) throw missing()
  return document as HtmlDocumentRow
}
export async function role(db: Database, document: HtmlDocumentRow, identity: ReportIdentity | null): Promise<'owner' | 'admin' | 'editor' | 'reader' | null> {
  if (identity?.publisherOnly) return null
  if (identity?.subject === document.owner) return 'owner'
  if (document.audience === 'team' && identity) {
    const membership = await row(db, 'SELECT role FROM team_members WHERE team_id = ? AND user_email = ?', [document.team_id, identity.subject])
    if (membership) return membership.role === 'owner' ? 'admin' : membership.role === 'editor' ? 'editor' : 'reader'
  }
  if (document.audience === 'public') return 'reader'
  if (document.audience === 'readers' && identity && (JSON.parse(String(document.readers)) as string[]).includes(identity.subject)) return 'reader'
  return null
}
async function assertEditor(db: Database, document: HtmlDocumentRow, identity: ReportIdentity) {
  if (identity.publisherOnly) {
    const series = await row(db, 'SELECT * FROM report_series WHERE id = ?', [document.series_id])
    if (series && series.owner === document.owner && series.publisher === identity.actor) return
    throw denied()
  }
  if (!['owner', 'admin', 'editor'].includes(await role(db, document, identity) ?? '')) throw denied()
}
async function assertAdmin(db: Database, document: HtmlDocumentRow, identity: ReportIdentity) {
  if (!['owner', 'admin'].includes(await role(db, document, identity) ?? '')) throw denied()
}
export async function audience(db: Database, input: unknown, identity: ReportIdentity) {
  const policy = object(input, ['mode', 'readers', 'teamId'])
  const mode = policy.mode
  if (!['private', 'public', 'readers', 'team'].includes(String(mode))) invalid('Select private, public, readers or team access')
  if (mode !== 'readers' && policy.readers !== undefined) invalid('Readers require the readers audience')
  if (mode !== 'team' && policy.teamId !== undefined) invalid('A team requires the team audience')
  let readers: string[] = []; let teamId: string | null = null
  if (mode === 'readers') {
    if (!Array.isArray(policy.readers) || policy.readers.length < 1 || policy.readers.length > 100) invalid('Supply 1–100 reader email addresses')
    readers = [...new Set(policy.readers.map((value) => {
      const email = label(value, 254, 'reader email')
      if (!/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/u.test(email)) invalid('Invalid reader email')
      return email.toLowerCase()
    }))]
  }
  if (mode === 'team') {
    teamId = label(policy.teamId, 100, 'team ID')
    const member = await row(db, 'SELECT m.role FROM team_members m JOIN teams t ON t.id=m.team_id WHERE m.team_id=? AND m.user_email=?', [teamId, identity.subject])
    if (!member || member.role === 'viewer' || identity.publisherOnly) throw denied()
  }
  return { mode: String(mode), readers, teamId }
}

const pending = new WeakMap<Client, Promise<void>>()
export async function transaction<T>(client: Client, operation: (tx: Transaction) => Promise<T>, options = { policyJournal: true }): Promise<T> {
  const previous = pending.get(client)
  let release!: () => void
  const waiting = new Promise<void>((resolve) => { release = resolve })
  pending.set(client, waiting)
  await previous
  try {
    for (let attempt = 0; ; attempt++) {
      let tx: Transaction | undefined
      try {
        tx = await client.transaction('write')
        const result = await operation(tx)
        if (options.policyJournal) await tx.execute('UPDATE html_policy_state SET revision=revision+1 WHERE id=1')
        await tx.commit()
        tx.close(); tx = undefined
        try { if (options.policyJournal) await writeHtmlPolicyJournal(client) }
        catch { throw new ReportError('JOURNAL_UNAVAILABLE', 'Policy journal persistence failed; the write may have committed. Reconcile before retrying.', 503) }
        return result
      }
      catch (error) {
        if (tx) await tx.rollback()
        if ((error as { code?: string }).code !== 'SQLITE_BUSY' || attempt >= 5) throw error
        await setTimeout(10 * 2 ** attempt)
      }
      finally { tx?.close() }
    }
  }
  finally { release(); if (pending.get(client) === waiting) pending.delete(client) }
}

export async function insertVersion(tx: Transaction, documentId: string, version: number, publication: HtmlPublication, author: string, now: number, source: string | null = null) {
  const id = ulid(); const artifactDigest = hash(publication.html)
  await tx.execute({ sql: `INSERT INTO html_versions (id,document_id,version,html,title,language,category,tags,metadata,external_images,external_links,source,author,created_at,artifact_digest,policy_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, args: [id, documentId, version, publication.html, publication.title, publication.language ?? null, publication.category ?? null, JSON.stringify(publication.tags), JSON.stringify(publication.metadata), JSON.stringify(publication.externalImages), JSON.stringify(publication.externalLinks), source, author, now, artifactDigest, HTML_POLICY] })
  return { id, artifactDigest }
}
export function snapshot(version: Row): HtmlPublication {
  return { title: String(version.title), html: String(version.html), ...(version.language ? { language: String(version.language) } : {}), ...(version.category ? { category: String(version.category) } : {}), tags: JSON.parse(String(version.tags)), metadata: JSON.parse(String(version.metadata)), externalImages: JSON.parse(String(version.external_images)), externalLinks: JSON.parse(String(version.external_links)) }
}
export async function publishHtml(client: Client, input: {
  publication?: HtmlPublication, changes?: Partial<HtmlMetadata>, documentId?: string, expectedVersion?: number,
  seriesId?: string, audience?: unknown, lifetime?: unknown,
}, raw: string, identity: ReportIdentity, key: string, base: string, now = Date.now()) {
  if (!/^[\w:.-]{1,200}$/u.test(key)) invalid('A 1–200 character idempotency key is required')
  const digest = hash(raw)
  return transaction(client, async (tx) => {
    const existing = await row(tx, 'SELECT * FROM html_receipts WHERE identity=? AND actor=? AND key=?', [identity.subject, identity.actor, key])
    if (existing) {
      if (existing.digest !== digest) throw conflict('Idempotency key already used with different bytes or policy')
      const current = await documentRow(tx, String(existing.document_id))
      await assertEditor(tx, current, identity)
      assertLive(current, now)
      return { ...JSON.parse(String(existing.receipt)), replayed: true }
    }
    let document: HtmlDocumentRow; let version = 1; let publication = input.publication; let source: string | null = null
    if (input.documentId) {
      if (input.audience !== undefined || input.lifetime !== undefined || input.seriesId !== undefined) invalid('Publication updates preserve audience, lifetime and series')
      document = await documentRow(tx, input.documentId)
      await assertEditor(tx, document, identity)
      assertLive(document, now)
      if (input.expectedVersion !== document.latest_version) throw conflict('Reload and reconcile the current document version')
      version = Number(document.latest_version) + 1
      if (input.changes) {
        const previous = await row(tx, 'SELECT * FROM html_versions WHERE document_id=? AND version=?', [document.id, document.latest_version])
        if (!previous) throw missing()
        source = previous.source === null ? null : String(previous.source)
        const old = snapshot(previous)
        publication = { ...old, ...normalizeMetadata({ title: old.title, language: old.language, category: old.category, tags: old.tags, metadata: old.metadata, ...input.changes }) }
      }
      await tx.execute({ sql: 'UPDATE html_documents SET latest_version=?,updated_at=? WHERE id=?', args: [version, now, document.id] })
    }
    else {
      if (input.expectedVersion !== undefined || input.changes) invalid('Updates require a document ID and expected version')
      const access = await audience(tx, input.audience ?? { mode: 'private' }, identity)
      if (input.seriesId) {
        const series = await row(tx, 'SELECT * FROM report_series WHERE id=?', [input.seriesId])
        if (!series || series.owner !== identity.subject || (identity.publisherOnly && series.publisher !== identity.actor) || access.mode !== 'private') throw denied()
      }
      else if (identity.publisherOnly) {
        throw denied()
      }
      const expiry = lifetime(input.lifetime ?? { permanent: true }, now)
      const id = ulid()
      await tx.execute({ sql: 'INSERT INTO html_documents (id,owner,series_id,team_id,audience,readers,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', args: [id, identity.subject, input.seriesId ?? null, access.teamId, access.mode, JSON.stringify(access.readers), expiry, now, now] })
      document = await documentRow(tx, id)
    }
    if (!publication) invalid('A complete HTML publication is required')
    const stored = await insertVersion(tx, String(document.id), version, publication, identity.actor, now, source)
    const url = `${base}/d/${document.id}`
    const receipt = { title: publication.title, language: publication.language ?? null, category: publication.category ?? null, tags: publication.tags, metadata: publication.metadata, document_id: document.id, publication_id: stored.id, version, url, version_url: `${url}?v=${version}`, digest, artifact_digest: stored.artifactDigest, policy_version: HTML_POLICY, audience: document.audience, expires_at: document.expires_at, access_revision: document.access_revision, retention_revision: document.retention_revision, replayed: false }
    await tx.execute({ sql: 'INSERT INTO html_receipts (identity,actor,key,digest,document_id,receipt) VALUES (?,?,?,?,?,?)', args: [identity.subject, identity.actor, key, digest, document.id, JSON.stringify(receipt)] })
    return receipt
  })
}

export async function readHtml(db: Database, id: string, identity: ReportIdentity | null, revision?: number, now = Date.now()) {
  const document = await documentRow(db, id)
  const callerRole = await role(db, document, identity)
  if (!callerRole) throw missing()
  assertLive(document, now)
  const version = await row(db, 'SELECT * FROM html_versions WHERE document_id=? AND version=?', [document.id, revision ?? document.latest_version])
  if (!version) throw missing()
  return { document, version, callerRole }
}
export async function manageHtml(client: Client, id: string, identity: ReportIdentity, action: string, input: unknown, now = Date.now()) {
  return transaction(client, async (tx) => {
    const document = await documentRow(tx, id)
    await assertAdmin(tx, document, identity)
    const fields: Record<string, string[]> = { restore: ['lifetime'], remove: ['expectedVersion'], access: ['audience', 'expectedAccessRevision'], retention: ['lifetime', 'expectedRetentionRevision'] }
    if (!fields[action]) invalid('Unknown lifecycle operation')
    const body = object(input, fields[action])
    if (action === 'restore') {
      const removed = removedAt(document, now)
      if (removed === null || now >= removed + RECOVERY_MS) throw new ReportError('GONE', 'Recovery is unavailable', 410)
      if (identity.subject !== document.owner) throw denied()
      if (document.series_id) {
        const series = await row(tx, 'SELECT owner FROM report_series WHERE id=?', [document.series_id])
        if (series?.owner !== document.owner) throw new ReportError('RECOVERY_BINDING', 'Series ownership must be reconciled before restoration', 409)
      }
      const expiry = lifetime(body.lifetime, now)
      await tx.execute({ sql: 'UPDATE html_documents SET audience=\'private\',readers=\'[]\',team_id=NULL,expires_at=?,removed_at=NULL,access_revision=access_revision+1,retention_revision=retention_revision+1 WHERE id=?', args: [expiry, document.id] })
    }
    else if (action === 'remove') {
      if (body.expectedVersion !== document.latest_version) throw conflict('Reload the current version before removal')
      if (removedAt(document, now) === null) await tx.execute({ sql: 'UPDATE html_documents SET removed_at=?,retention_revision=retention_revision+1 WHERE id=?', args: [now, document.id] })
    }
    else {
      assertLive(document, now)
      if (action === 'access') {
        if (body.expectedAccessRevision !== document.access_revision) throw conflict('Reload the current access revision')
        if (document.series_id) throw new ReportError('SERIES_BINDING', 'Series-bound documents must retain private owner access', 409)
        const access = await audience(tx, body.audience, identity)
        await tx.execute({ sql: 'UPDATE html_documents SET audience=?,readers=?,team_id=?,access_revision=access_revision+1 WHERE id=?', args: [access.mode, JSON.stringify(access.readers), access.teamId, document.id] })
      }
      else if (action === 'retention') {
        if (body.expectedRetentionRevision !== document.retention_revision) throw conflict('Reload the current retention revision')
        await tx.execute({ sql: 'UPDATE html_documents SET expires_at=?,retention_revision=retention_revision+1 WHERE id=?', args: [lifetime(body.lifetime, now), document.id] })
      }
      else {
        invalid('Unknown lifecycle operation')
      }
    }
    return await documentRow(tx, id)
  })
}
export async function purgeHtml(client: Client, now = Date.now()) {
  return transaction(client, async (tx) => {
    const candidates = (await tx.execute({ sql: 'SELECT * FROM html_documents WHERE purged_at IS NULL AND ((removed_at IS NOT NULL AND removed_at<=?) OR (expires_at IS NOT NULL AND expires_at<=?))', args: [now - RECOVERY_MS, now - RECOVERY_MS] })).rows as HtmlDocumentRow[]
    for (const document of candidates) {
      await tx.execute({ sql: 'DELETE FROM html_versions WHERE document_id=?', args: [document.id] })
      await tx.execute({ sql: 'UPDATE html_receipts SET receipt=? WHERE document_id=?', args: [JSON.stringify({ document_id: document.id, purged: true }), document.id] })
      await tx.execute({ sql: 'UPDATE html_documents SET purged_at=?,team_id=NULL,readers=\'[]\',audience=\'private\',series_id=NULL,legacy_plan_id=NULL WHERE id=?', args: [now, document.id] })
    }
    return candidates.length
  })
}
