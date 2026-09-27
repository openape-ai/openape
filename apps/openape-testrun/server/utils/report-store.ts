import type { Client } from '@libsql/client'
import type { Briefing } from '../../shared/briefing'
import { createHash, randomBytes } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { ulid } from 'ulid'
import { createProblemError } from './problem'

export async function createReportSeries(client: Client, owner: string, name: string) {
  const id = ulid(); const slug = randomBytes(18).toString('base64url')
  await client.execute({ sql: 'INSERT INTO report_series (id, owner, name, slug, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner, name) DO NOTHING', args: [id, owner, name, slug, Date.now()] })
  return (await client.execute({ sql: 'SELECT id, name, slug, publisher, revision FROM report_series WHERE owner = ? AND name = ?', args: [owner, name] })).rows[0]!
}

async function publishBriefingOnce(client: Client, briefing: Briefing, raw: string, publisher: string, key: string) {
  const digest = createHash('sha256').update(raw).digest('hex')
  const tx = await client.transaction('write')
  try {
    const series = (await tx.execute({ sql: 'SELECT * FROM report_series WHERE id = ?', args: [briefing.seriesId] })).rows[0]
    if (!series || (series.owner !== publisher && series.publisher !== publisher)) throw createProblemError({ status: 404, title: 'Report series not found' })
    const existing = (await tx.execute({ sql: 'SELECT * FROM report_publications WHERE series_id = ? AND (edition_date = ? OR idempotency_key = ?)', args: [briefing.seriesId, briefing.editionDate, key] })).rows[0]
    if (existing) {
      if (existing.digest !== digest || existing.publisher !== publisher || existing.idempotency_key !== key || existing.edition_date !== briefing.editionDate) throw createProblemError({ status: 409, title: 'Edition already exists with different publication data' })
      await tx.commit()
      return { id: String(existing.id), slug: String(series.slug), version: Number(existing.version), digest, replayed: true }
    }
    const latest = (await tx.execute({ sql: 'SELECT edition_date, version FROM report_publications WHERE series_id = ? ORDER BY version DESC LIMIT 1', args: [briefing.seriesId] })).rows[0]
    if (latest && String(latest.edition_date) >= briefing.editionDate) throw createProblemError({ status: 409, title: 'An older edition cannot replace the latest report' })
    const version = latest ? Number(latest.version) + 1 : 1
    const now = Math.floor(Date.now() / 1000)
    if (latest) {
      await tx.execute({ sql: `INSERT INTO run_versions (id, run_id, version, report_type, title, project, summary, status, passed_count, failed_count, skipped_count, manifest, started_at, finished_at, created_at)
        SELECT ?, id, version, report_type, title, project, summary, status, passed_count, failed_count, skipped_count, manifest, started_at, finished_at, created_at FROM runs WHERE id = ?`, args: [ulid(), briefing.seriesId] })
      const updated = await tx.execute({ sql: 'UPDATE runs SET title = ?, summary = ?, manifest = ?, version = ?, created_at = ? WHERE id = ?', args: [briefing.title, briefing.overview, JSON.stringify(briefing), version, now, briefing.seriesId] })
      if (updated.rowsAffected !== 1) throw new Error('Latest report is missing; publication aborted')
    }
    else {
      await tx.execute({ sql: `INSERT INTO runs (id, slug, report_type, visibility, title, summary, status, manifest, created_by, created_by_act, created_at, series, version)
        VALUES (?, ?, 'briefing', 'private', ?, ?, NULL, ?, ?, 'agent', ?, ?, 1)`, args: [briefing.seriesId, series.slug!, briefing.title, briefing.overview, JSON.stringify(briefing), series.owner!, now, briefing.seriesId] })
    }
    const id = ulid()
    await tx.execute({ sql: 'INSERT INTO report_publications (id, series_id, edition_date, version, digest, idempotency_key, publisher, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', args: [id, briefing.seriesId, briefing.editionDate, version, digest, key, publisher, now] })
    await tx.commit()
    return { id, slug: String(series.slug), version, digest, replayed: false }
  }
  catch (error) { await tx.rollback(); throw error }
  finally { tx.close() }
}

const pendingPublications = new WeakMap<Client, Promise<void>>()
export async function publishBriefing(client: Client, briefing: Briefing, raw: string, publisher: string, key: string) {
  const previous = pendingPublications.get(client)
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  pendingPublications.set(client, pending)
  await previous
  try {
    for (let attempt = 0; ; attempt++) {
      try { return await publishBriefingOnce(client, briefing, raw, publisher, key) }
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
