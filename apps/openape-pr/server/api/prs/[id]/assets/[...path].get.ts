import { and, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, setResponseHeader } from 'h3'
import { useDb } from '../../../../database/drizzle'
import { assets } from '../../../../database/schema'
import { createProblemError } from '../../../../utils/problem'
import { requireCaller } from '../../../../utils/require-auth'
import { loadPrById } from '../../../../utils/pr-access'

/**
 * GET /api/prs/:id/assets/<path> — serve an uploaded image (auth required).
 * Referenced by rendered description/comment markdown; the browser sends the
 * reviewer's session cookie automatically.
 */
export default defineEventHandler(async (event) => {
  await requireCaller(event)
  const id = getRouterParam(event, 'id')!
  const pr = await loadPrById(id)
  const path = getRouterParam(event, 'path')
  const decoded = path ? decodeURIComponent(path) : ''

  const db = useDb()
  const asset = await db.select().from(assets)
    .where(and(eq(assets.prId, pr.id), eq(assets.path, decoded)))
    .get()
  if (!asset) throw createProblemError({ status: 404, title: 'Asset not found' })

  setResponseHeader(event, 'content-type', asset.contentType)
  setResponseHeader(event, 'cache-control', 'private, max-age=300')
  return asset.bytes
})
