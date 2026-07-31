import { randomBytes } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { runs, runVersions } from '../../database/schema'
import { publicRunUrl } from '../../utils/run-access'
import { aggregateStatus, referencedShots, validateManifest } from '../../utils/run-shape'

/**
 * POST /api/runs — create a run from a manifest (auth required).
 *
 * With a manifest `series` key, a re-upload by the SAME uploader updates the
 * existing run in place: same id, same slug (the link stays stable), version
 * incremented, the previous version archived and viewable via ?v=<n>. The
 * series is scoped per uploader — another caller using the same key gets an
 * independent run, so a link can never be taken over. Without `series` every
 * upload creates a fresh run, as before.
 *
 * Screenshots are uploaded afterwards, one PUT per file:
 *   PUT /api/runs/:id/assets/<shot-path>
 *
 * Response (201): { id, slug, url, status, version, expected_assets }
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const manifest = validateManifest(await readBody(event))
  const { status, passed, failed, skipped } = aggregateStatus(manifest.tests)
  const now = Math.floor(Date.now() / 1000)
  const db = useDb()

  const fields = {
    title: manifest.title,
    project: manifest.project ?? null,
    summary: manifest.summary ?? null,
    status,
    passedCount: passed,
    failedCount: failed,
    skippedCount: skipped,
    manifest: JSON.stringify(manifest),
    startedAt: manifest.startedAt ? Math.floor(Date.parse(manifest.startedAt) / 1000) || null : null,
    finishedAt: manifest.finishedAt ? Math.floor(Date.parse(manifest.finishedAt) / 1000) || null : null,
  }

  const head = manifest.series
    ? await db.select().from(runs).where(and(eq(runs.createdBy, caller.email), eq(runs.series, manifest.series), isNull(runs.deletedAt))).orderBy(desc(runs.version)).limit(1).get()
    : undefined

  if (head) {
    await db.insert(runVersions).values({
      id: ulid(),
      runId: head.id,
      version: head.version,
      title: head.title,
      project: head.project,
      summary: head.summary,
      status: head.status,
      passedCount: head.passedCount,
      failedCount: head.failedCount,
      skippedCount: head.skippedCount,
      manifest: head.manifest,
      startedAt: head.startedAt,
      finishedAt: head.finishedAt,
      createdAt: head.createdAt,
    })
    const version = head.version + 1
    await db.update(runs)
      .set({ ...fields, version, createdByAct: caller.act, createdAt: now })
      .where(eq(runs.id, head.id))

    setResponseStatus(event, 201)
    return {
      id: head.id,
      slug: head.slug,
      url: publicRunUrl(event, head.slug),
      status,
      version,
      expected_assets: referencedShots(manifest),
    }
  }

  const id = ulid()
  const slug = randomBytes(18).toString('base64url')
  await db.insert(runs).values({
    id,
    slug,
    ...fields,
    series: manifest.series ?? null,
    version: 1,
    createdBy: caller.email,
    createdByAct: caller.act,
    createdAt: now,
  })

  setResponseStatus(event, 201)
  return {
    id,
    slug,
    url: publicRunUrl(event, slug),
    status,
    version: 1,
    expected_assets: referencedShots(manifest),
  }
})
