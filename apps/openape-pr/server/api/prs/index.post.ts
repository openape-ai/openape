import { randomBytes } from 'node:crypto'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { prs } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { reviewUrl } from '../../utils/pr-access'
import { diffStats, validatePrManifest } from '../../utils/pr-shape'

/**
 * POST /api/prs — create a PR for review from a manifest (auth required).
 *
 * Description/comment images are uploaded afterwards, one PUT per file:
 *   PUT /api/prs/:id/assets/<path>
 *
 * Response (201): { id, slug, review_url, files, additions, deletions }
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const manifest = validatePrManifest(await readBody(event))
  const { files, additions, deletions } = diffStats(manifest.diff)

  const id = ulid()
  const slug = randomBytes(18).toString('base64url')
  const now = Math.floor(Date.now() / 1000)

  const db = useDb()
  await db.insert(prs).values({
    id,
    slug,
    title: manifest.title,
    description: manifest.description ?? null,
    author: manifest.author ?? caller.email,
    authorAct: manifest.authorAct,
    branch: manifest.branch ?? null,
    baseSha: manifest.baseSha ?? null,
    headSha: manifest.headSha ?? null,
    diff: manifest.diff,
    status: 'pending',
    filesCount: files,
    additions,
    deletions,
    createdBy: caller.email,
    createdByAct: caller.act,
    createdAt: now,
  })

  setResponseStatus(event, 201)
  return {
    id,
    slug,
    review_url: reviewUrl(event, id),
    files,
    additions,
    deletions,
  }
})
