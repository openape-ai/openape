import { eq } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useDb } from '../../database/drizzle'
import { assets } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { loadOwnRun, publicRunUrl } from '../../utils/run-access'

/**
 * GET /api/runs/:id — full run detail for the uploader (auth required).
 * Includes which manifest-referenced assets have been uploaded so far.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const run = await loadOwnRun(event, caller)

  const db = useDb()
  const uploaded = await db.select({ path: assets.path, size: assets.size }).from(assets)
    .where(eq(assets.runId, run.id))

  return {
    id: run.id,
    slug: run.slug,
    url: publicRunUrl(event, run.slug),
    title: run.title,
    project: run.project,
    summary: run.summary,
    status: run.status,
    passed: run.passedCount,
    failed: run.failedCount,
    skipped: run.skippedCount,
    manifest: JSON.parse(run.manifest),
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    created_by: run.createdBy,
    created_by_act: run.createdByAct,
    created_at: run.createdAt,
    assets: uploaded,
  }
})
