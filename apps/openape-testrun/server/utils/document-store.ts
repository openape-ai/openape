import type { Client, Row } from '@libsql/client'
import type { ReportDocument } from '../../shared/document'
import { createHash, randomBytes } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { ulid } from 'ulid'
import { createProblemError } from './problem'
import { reportCategory } from './document-shape'
import { sanitizeDocument } from './document-sanitizer'

function receipt(row: Row, slug: string, replayed: boolean) {
  return { id: String(row.id), slug, version: Number(row.version), digest: String(row.digest), artifactDigest: String(row.artifact_digest), policyVersion: String(row.policy_version), replayed }
}

async function publishOnce(client: Client, document: ReportDocument, raw: string, owner: string, publisher: string, key: string) {
  const digest = createHash('sha256').update(raw).digest('hex')
  const tx = await client.transaction('write')
  try {
    if (document.seriesId) {
      const series = (await tx.execute({ sql: 'SELECT owner, publisher FROM report_series WHERE id = ?', args: [document.seriesId] })).rows[0]
      if (!series || series.owner !== owner || (publisher !== owner && series.publisher !== publisher)) throw createProblemError({ status: 404, title: 'Report series not found' })
    }
    else if (publisher !== owner) {
      throw createProblemError({ status: 403, title: 'A publisher requires its assigned series' })
    }
    const existing = (await tx.execute({ sql: 'SELECT p.*, r.slug FROM document_publications p JOIN runs r ON r.id = p.id WHERE p.owner = ? AND p.idempotency_key = ?', args: [owner, key] })).rows[0]
    if (existing) {
      if (existing.digest !== digest || existing.publisher !== publisher) throw createProblemError({ status: 409, title: 'Idempotency key already used with different data' })
      await tx.commit()
      return receipt(existing, String(existing.slug), true)
    }
    const { artifact, artifactDigest, policyVersion } = sanitizeDocument(document)
    const latest = document.seriesId ? (await tx.execute({ sql: 'SELECT MAX(version) AS version FROM document_publications WHERE series_id = ?', args: [document.seriesId] })).rows[0] : undefined
    const version = Number(latest?.version ?? 0) + 1
    const category = document.category ? reportCategory(document.category) : null
    const id = ulid(); const slug = randomBytes(18).toString('base64url'); const now = Math.floor(Date.now() / 1000)
    await tx.execute({ sql: `INSERT INTO runs (id, slug, report_type, visibility, title, status, manifest, created_by, created_by_act, created_at)
      VALUES (?, ?, 'document', 'private', ?, NULL, '{}', ?, ?, ?)`, args: [id, slug, document.title, owner, publisher === owner ? 'human' : 'agent', now] })
    await tx.execute({ sql: `INSERT INTO document_publications (id, series_id, version, owner, publisher, idempotency_key, digest, artifact_digest, policy_version, category, category_key, language, artifact, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: [id, document.seriesId ?? null, version, owner, publisher, key, digest, artifactDigest, policyVersion, category?.label ?? null, category?.key ?? null, document.language ?? null, artifact, now] })
    await tx.commit()
    return { id, slug, version, digest, artifactDigest, policyVersion, replayed: false }
  }
  catch (error) { await tx.rollback(); throw error }
  finally { tx.close() }
}

const pendingPublications = new WeakMap<Client, Promise<void>>()
export async function publishDocument(client: Client, document: ReportDocument, raw: string, owner: string, publisher: string, key: string) {
  const previous = pendingPublications.get(client)
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  pendingPublications.set(client, pending)
  await previous
  try {
    for (let attempt = 0; ; attempt++) {
      try { return await publishOnce(client, document, raw, owner, publisher, key) }
      catch (error) {
        if ((error as { code?: string }).code !== 'SQLITE_BUSY' || attempt >= 5) throw error
        await setTimeout(Math.min(10 * 2 ** attempt, 160))
      }
    }
  }
  finally {
    release()
    if (pendingPublications.get(client) === pending) pendingPublications.delete(client)
  }
}
