import { eq } from 'drizzle-orm'
import { defineEventHandler, setResponseStatus } from 'h3'
import { useDb } from '../../database/drizzle'
import { assets, comments, prs, reviews } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { loadOwnPr } from '../../utils/pr-access'

/**
 * DELETE /api/prs/:id — delete a PR and its data (uploader only).
 * The row is soft-deleted (slug stops resolving); assets, reviews and
 * comments are removed immediately.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const pr = await loadOwnPr(event, caller)

  const db = useDb()
  const now = Math.floor(Date.now() / 1000)
  await db.update(prs).set({ deletedAt: now }).where(eq(prs.id, pr.id))
  await db.delete(assets).where(eq(assets.prId, pr.id))
  await db.delete(comments).where(eq(comments.prId, pr.id))
  await db.delete(reviews).where(eq(reviews.prId, pr.id))

  setResponseStatus(event, 204)
  return null
})
