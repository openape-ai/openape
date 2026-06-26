import { desc, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../database/drizzle'
import { comments, reviews } from '../../../database/schema'
import { requireCaller } from '../../../utils/require-auth'
import { loadPrBySlugOrId } from '../../../utils/pr-access'

/**
 * GET /api/prs/:slug/review — poll the verdict (auth required, bearer-friendly).
 *
 * The uploading agent polls this with the slug from the upload response.
 * Returns `{ state: "pending" }` until a human submits a review, then the
 * full verdict + raw (markdown) inline comments for the agent to act on.
 */
export default defineEventHandler(async (event) => {
  await requireCaller(event)
  const handle = getRouterParam(event, 'id')!
  const pr = await loadPrBySlugOrId(handle)

  if (pr.status !== 'reviewed') {
    return { state: 'pending' as const, pr_id: pr.id, title: pr.title }
  }

  const db = useDb()
  const review = await db.select().from(reviews)
    .where(eq(reviews.prId, pr.id))
    .orderBy(desc(reviews.reviewedAt))
    .get()
  if (!review) return { state: 'pending' as const, pr_id: pr.id, title: pr.title }

  const commentRows = await db.select().from(comments).where(eq(comments.reviewId, review.id))

  return {
    state: 'reviewed' as const,
    pr_id: pr.id,
    title: pr.title,
    verdict: review.verdict,
    body: review.body,
    reviewed_by: review.reviewedBy,
    reviewed_at: review.reviewedAt,
    comments: commentRows.map(c => ({
      path: c.path,
      line: c.line,
      side: c.side,
      body: c.body,
      image_path: c.imagePath,
    })),
  }
})
