import { randomBytes } from 'node:crypto'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { runs } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { publicRunUrl } from '../../utils/run-access'
import { aggregateStatus, referencedShots, validateManifest } from '../../utils/run-shape'

/**
 * POST /api/runs — create a run from a manifest (auth required).
 *
 * Screenshots are uploaded afterwards, one PUT per file:
 *   PUT /api/runs/:id/assets/<shot-path>
 *
 * Response (201): { id, slug, url, status, expected_assets }
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const manifest = validateManifest(await readBody(event))
  const { status, passed, failed, skipped } = aggregateStatus(manifest.tests)

  const id = ulid()
  const slug = randomBytes(18).toString('base64url')
  const now = Math.floor(Date.now() / 1000)

  const db = useDb()
  await db.insert(runs).values({
    id,
    slug,
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
    expected_assets: referencedShots(manifest),
  }
})
