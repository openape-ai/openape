import { assertPublicUrl } from '@openape/core'
import { eq } from 'drizzle-orm'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { DEFAULT_INTERVAL_SEC, MIN_INTERVAL_SEC, monitors } from '../../database/schema'
import { runCheck } from '../../utils/check'
import { createProblemError } from '../../utils/problem'

interface Body {
  url?: unknown
  name?: unknown
  intervalSec?: unknown
}

/**
 * POST /api/monitors — add a monitor (auth required).
 * Body: { url, name?, intervalSec? }. The URL is SSRF-checked before it is
 * stored, so a private/loopback target is rejected up front.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<Body>(event)

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url) throw createProblemError({ status: 400, title: 'url required' })
  try {
    await assertPublicUrl(url)
  }
  catch (err) {
    throw createProblemError({ status: 400, title: 'Unsafe or invalid URL', detail: (err as Error).message })
  }

  const name = typeof body.name === 'string' && body.name.trim()
    ? body.name.trim().slice(0, 120)
    : new URL(url).host

  const intervalSec = Number.isFinite(Number(body.intervalSec))
    ? Math.max(MIN_INTERVAL_SEC, Math.floor(Number(body.intervalSec)))
    : DEFAULT_INTERVAL_SEC

  const id = ulid()
  const db = useDb()
  await db.insert(monitors).values({
    id,
    ownerEmail: caller.email,
    name,
    url,
    intervalSec,
    createdAt: Math.floor(Date.now() / 1000),
  })

  // First check now so the dashboard shows a status immediately (no alert:
  // there is no previous status to transition from).
  const [monitor] = await db.select().from(monitors).where(eq(monitors.id, id))
  const result = monitor ? await runCheck(monitor) : null

  setResponseStatus(event, 201)
  return { id, name, url, interval_sec: intervalSec, status: result?.up ? 'up' : result ? 'down' : null }
})
