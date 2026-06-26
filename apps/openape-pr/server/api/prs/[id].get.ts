import { desc, eq } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useDb } from '../../database/drizzle'
import { comments, reviews } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { loadPrById } from '../../utils/pr-access'
import { renderMarkdownWithAssets } from '../../utils/markdown'

/**
 * GET /api/prs/:id — full PR detail for review (auth required).
 * Returns the raw diff (rendered client-side by diff2html), the rendered
 * description, and the latest review with its inline comments (if any).
 */
export default defineEventHandler(async (event) => {
  await requireCaller(event)
  const id = getRouterParam(event, 'id')!
  const pr = await loadPrById(id)
  const assetBase = `/api/prs/${pr.id}/assets`

  const db = useDb()
  const review = await db.select().from(reviews)
    .where(eq(reviews.prId, pr.id))
    .orderBy(desc(reviews.reviewedAt))
    .get()
  const commentRows = review
    ? await db.select().from(comments).where(eq(comments.reviewId, review.id))
    : []

  return {
    id: pr.id,
    slug: pr.slug,
    title: pr.title,
    description_html: renderMarkdownWithAssets(pr.description, assetBase),
    author: pr.author,
    author_act: pr.authorAct,
    branch: pr.branch,
    base_sha: pr.baseSha,
    head_sha: pr.headSha,
    diff: pr.diff,
    status: pr.status,
    files: pr.filesCount,
    additions: pr.additions,
    deletions: pr.deletions,
    created_by: pr.createdBy,
    created_by_act: pr.createdByAct,
    created_at: pr.createdAt,
    review: review
      ? {
          verdict: review.verdict,
          body_html: renderMarkdownWithAssets(review.body, assetBase),
          reviewed_by: review.reviewedBy,
          reviewed_at: review.reviewedAt,
          comments: commentRows.map(c => ({
            path: c.path,
            line: c.line,
            side: c.side,
            body_html: renderMarkdownWithAssets(c.body, assetBase),
            image_url: c.imagePath ? `${assetBase}/${c.imagePath}` : null,
          })),
        }
      : null,
  }
})
