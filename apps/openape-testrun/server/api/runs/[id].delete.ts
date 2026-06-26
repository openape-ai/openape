import { eq } from 'drizzle-orm'
import { defineEventHandler, setResponseStatus } from 'h3'
import { useDb } from '../../database/drizzle'
import { assets, runs } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { loadOwnRun } from '../../utils/run-access'

/**
 * DELETE /api/runs/:id — delete a run and its assets (uploader only).
 * The run row is soft-deleted (slug stops resolving); asset blobs are
 * removed immediately to free space.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const run = await loadOwnRun(event, caller)

  const db = useDb()
  const now = Math.floor(Date.now() / 1000)
  await db.update(runs).set({ deletedAt: now }).where(eq(runs.id, run.id))
  await db.delete(assets).where(eq(assets.runId, run.id))

  setResponseStatus(event, 204)
  return null
})
