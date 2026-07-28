import { and, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, setHeader } from 'h3'
import { useDb } from '../../../../../database/drizzle'
import { assets } from '../../../../../database/schema'
import { createProblemError } from '../../../../../utils/problem'
import { loadRunBySlug } from '../../../../../utils/run-access'

/**
 * GET /api/public/runs/:slug/assets/<path> — screenshot bytes, NO auth
 * (slug-gated like the report itself). Content is immutable per path.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  const path = getRouterParam(event, 'path')
  if (!slug || !path) throw createProblemError({ status: 400, title: 'Slug and path required' })
  const run = await loadRunBySlug(slug)

  const db = useDb()
  const asset = await db.select().from(assets)
    .where(and(eq(assets.runId, run.id), eq(assets.path, decodeURIComponent(path))))
    .get()
  if (!asset) throw createProblemError({ status: 404, title: 'Asset not found' })

  setHeader(event, 'content-type', asset.contentType)
  setHeader(event, 'content-length', asset.size)
  setHeader(event, 'cache-control', 'public, max-age=31536000, immutable')
  return asset.bytes
})
