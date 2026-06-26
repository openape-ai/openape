import { and, eq } from 'drizzle-orm'
import { defineEventHandler, getHeader, getRouterParam, readRawBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../../database/drizzle'
import { assets } from '../../../../database/schema'
import { createProblemError } from '../../../../utils/problem'
import { requireCaller } from '../../../../utils/require-auth'
import { loadPrById } from '../../../../utils/pr-access'
import { ASSET_PATH } from '../../../../utils/pr-shape'

const MAX_ASSET_BYTES = 8 * 1024 * 1024
const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/**
 * PUT /api/prs/:id/assets/<path> — upload one image (raw binary body).
 *
 * Allowed for the PR's uploader (description images) or any human reviewer
 * (inline-comment images). The path must be a safe relative image path.
 * Re-uploading the same path replaces the previous bytes.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')!
  const pr = await loadPrById(id)
  if (pr.createdBy !== caller.email && caller.act !== 'human') {
    throw createProblemError({ status: 403, title: 'Forbidden', detail: 'Only the uploader or a human reviewer can attach images.' })
  }

  const path = getRouterParam(event, 'path')
  const decoded = path ? decodeURIComponent(path) : ''
  if (!ASSET_PATH.test(decoded)) {
    throw createProblemError({
      status: 400,
      title: 'Invalid asset path',
      detail: `"${decoded}" must be a relative image path (png/jpg/webp/gif, segments of letters, digits, ".", "_", "-").`,
    })
  }

  const body = await readRawBody(event, false)
  if (!body || !(body instanceof Buffer) || body.length === 0) {
    throw createProblemError({ status: 400, title: 'Empty body', detail: 'Send the raw image bytes as the request body.' })
  }
  if (body.length > MAX_ASSET_BYTES) {
    throw createProblemError({ status: 413, title: 'Asset too large', detail: `Max ${MAX_ASSET_BYTES / 1024 / 1024}MB per asset.` })
  }

  const extension = decoded.split('.').pop()!.toLowerCase()
  const contentType = getHeader(event, 'content-type')?.split(';')[0]?.trim() || CONTENT_TYPES[extension] || 'application/octet-stream'

  const db = useDb()
  const now = Math.floor(Date.now() / 1000)
  await db.delete(assets).where(and(eq(assets.prId, pr.id), eq(assets.path, decoded)))
  await db.insert(assets).values({
    id: ulid(),
    prId: pr.id,
    path: decoded,
    contentType,
    size: body.length,
    bytes: body,
    createdAt: now,
  })

  setResponseStatus(event, 201)
  return { path: decoded, size: body.length, content_type: contentType }
})
