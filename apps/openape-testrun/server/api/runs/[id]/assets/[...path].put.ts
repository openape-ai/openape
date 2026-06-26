import { and, eq } from 'drizzle-orm'
import { defineEventHandler, getHeader, getRouterParam, readRawBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../../database/drizzle'
import { assets } from '../../../../database/schema'
import { createProblemError } from '../../../../utils/problem'
import { requireCaller } from '../../../../utils/require-auth'
import { loadOwnRun } from '../../../../utils/run-access'
import { referencedShots } from '../../../../utils/run-shape'

const MAX_ASSET_BYTES = 8 * 1024 * 1024
const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/**
 * PUT /api/runs/:id/assets/<path> — upload one screenshot (uploader only).
 * Raw binary body. The path must be referenced by the run's manifest
 * (`shot` field), which also guarantees it is a safe relative image path.
 * Re-uploading the same path replaces the previous bytes.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const run = await loadOwnRun(event, caller)

  const path = getRouterParam(event, 'path')
  const decoded = path ? decodeURIComponent(path) : ''
  const manifest = JSON.parse(run.manifest)
  if (!referencedShots(manifest).includes(decoded)) {
    throw createProblemError({
      status: 400,
      title: 'Unknown asset path',
      detail: `"${decoded}" is not referenced by any step's "shot" in this run's manifest.`,
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
  await db.delete(assets).where(and(eq(assets.runId, run.id), eq(assets.path, decoded)))
  await db.insert(assets).values({
    id: ulid(),
    runId: run.id,
    path: decoded,
    contentType,
    size: body.length,
    bytes: body,
    createdAt: now,
  })

  setResponseStatus(event, 201)
  return { path: decoded, size: body.length, content_type: contentType }
})
