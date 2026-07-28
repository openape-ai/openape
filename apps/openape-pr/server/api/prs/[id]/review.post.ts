import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../database/drizzle'
import { comments, prs, reviews } from '../../../database/schema'
import { createProblemError } from '../../../utils/problem'
import { requireHuman } from '../../../utils/require-auth'
import { loadPrById } from '../../../utils/pr-access'

const VERDICTS = ['approve', 'request-changes', 'comment'] as const
const SIDES = ['old', 'new'] as const
const MAX_COMMENTS = 500

type Verdict = typeof VERDICTS[number]
type Side = typeof SIDES[number]

interface InlineComment {
  path: string
  line: number
  side: Side
  body: string
  imagePath?: string
}

function parseComments(raw: unknown): InlineComment[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw createProblemError({ status: 400, title: 'Invalid review', detail: '"comments" must be an array.' })
  if (raw.length > MAX_COMMENTS) throw createProblemError({ status: 400, title: 'Invalid review', detail: `At most ${MAX_COMMENTS} comments.` })
  return raw.map((c, i) => {
    if (typeof c !== 'object' || c === null) throw createProblemError({ status: 400, title: 'Invalid review', detail: `comments[${i}] must be an object.` })
    const o = c as Record<string, unknown>
    const path = o.path
    const line = o.line
    const body = o.body
    if (typeof path !== 'string' || !path.trim()) throw createProblemError({ status: 400, title: 'Invalid review', detail: `comments[${i}].path is required.` })
    if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) throw createProblemError({ status: 400, title: 'Invalid review', detail: `comments[${i}].line must be a positive integer.` })
    if (typeof body !== 'string' || !body.trim()) throw createProblemError({ status: 400, title: 'Invalid review', detail: `comments[${i}].body is required.` })
    const side: Side = o.side === 'old' ? 'old' : 'new'
    const imagePath = typeof o.imagePath === 'string' && o.imagePath.trim() ? o.imagePath.trim() : undefined
    return { path: path.trim(), line, side, body: body.trim(), imagePath }
  })
}

/**
 * POST /api/prs/:id/review — submit a review (human only).
 * Body: { verdict, body?, comments?: [{ path, line, side?, body, imagePath? }] }
 * Replaces any prior review on this PR and flips its status to "reviewed".
 */
export default defineEventHandler(async (event) => {
  const caller = await requireHuman(event)
  const id = getRouterParam(event, 'id')!
  const pr = await loadPrById(id)

  const raw = await readBody<Record<string, unknown>>(event)
  const verdict = raw?.verdict
  if (!VERDICTS.includes(verdict as Verdict)) {
    throw createProblemError({ status: 400, title: 'Invalid review', detail: `"verdict" must be one of ${VERDICTS.join(', ')}.` })
  }
  const body = typeof raw?.body === 'string' && raw.body.trim() ? raw.body.trim() : null
  const inline = parseComments(raw?.comments)

  const db = useDb()
  const now = Math.floor(Date.now() / 1000)
  const reviewId = ulid()

  // One review per PR — replace any prior one (and its comments).
  const prior = await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.prId, pr.id))
  for (const p of prior) await db.delete(comments).where(eq(comments.reviewId, p.id))
  await db.delete(reviews).where(eq(reviews.prId, pr.id))

  await db.insert(reviews).values({
    id: reviewId,
    prId: pr.id,
    verdict: verdict as Verdict,
    body,
    reviewedBy: caller.email,
    reviewedAt: now,
  })
  for (const c of inline) {
    await db.insert(comments).values({
      id: ulid(),
      prId: pr.id,
      reviewId,
      path: c.path,
      line: c.line,
      side: c.side,
      body: c.body,
      imagePath: c.imagePath ?? null,
      createdAt: now,
    })
  }
  await db.update(prs).set({ status: 'reviewed' }).where(eq(prs.id, pr.id))

  setResponseStatus(event, 201)
  return { state: 'reviewed', verdict, comments: inline.length }
})
