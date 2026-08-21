import { randomBytes } from 'node:crypto'
import { assertPublicUrl } from '@openape/core'
import { eq } from 'drizzle-orm'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { DEFAULT_INTERVAL_SEC, MIN_INTERVAL_SEC, monitors } from '../../database/schema'
import { runCheck } from '../../utils/check'
import { pingUrlFor } from '../../utils/ping-url'
import { createProblemError } from '../../utils/problem'

interface Body {
  url?: unknown
  name?: unknown
  intervalSec?: unknown
  kind?: unknown
}

/**
 * POST /api/monitors — add a monitor (auth required).
 *
 * Body: { kind?, url, name?, intervalSec? }.
 * - `http` (default): the URL is SSRF-checked before it is stored, so a
 *   private/loopback target is rejected up front.
 * - `heartbeat`: no URL. `name` is required (there is no host to fall back
 *   on) and the response carries the ping URL — the only time the token is
 *   handed out in full.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<Body>(event)
  const heartbeat = body.kind === 'heartbeat'

  let url = ''
  if (!heartbeat) {
    url = typeof body.url === 'string' ? body.url.trim() : ''
    if (!url) throw createProblemError({ status: 400, title: 'url required' })
    try {
      await assertPublicUrl(url)
    }
    catch (err) {
      throw createProblemError({ status: 400, title: 'Unsafe or invalid URL', detail: (err as Error).message })
    }
  }

  const givenName = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
  if (heartbeat && !givenName)
    throw createProblemError({ status: 400, title: 'name required for a heartbeat monitor' })
  const name = givenName || new URL(url).host

  const intervalSec = Number.isFinite(Number(body.intervalSec))
    ? Math.max(MIN_INTERVAL_SEC, Math.floor(Number(body.intervalSec)))
    : DEFAULT_INTERVAL_SEC

  const id = ulid()
  const pingToken = heartbeat ? randomBytes(24).toString('base64url') : null
  const db = useDb()
  await db.insert(monitors).values({
    id,
    ownerEmail: caller.email,
    name,
    kind: heartbeat ? 'heartbeat' : 'http',
    url,
    pingToken,
    intervalSec,
    createdAt: Math.floor(Date.now() / 1000),
  })

  // For http monitors, check right away so the dashboard shows a status
  // immediately (no alert: there is no previous status to transition from).
  // A heartbeat has nothing to check yet — leave the status null so the first
  // ping reads as "started reporting", not as a recovery from an outage that
  // never happened.
  let result = null
  if (!heartbeat) {
    const [monitor] = await db.select().from(monitors).where(eq(monitors.id, id))
    result = monitor ? await runCheck(monitor) : null
  }

  setResponseStatus(event, 201)
  return {
    id,
    name,
    kind: heartbeat ? 'heartbeat' : 'http',
    url,
    interval_sec: intervalSec,
    status: result?.up ? 'up' : result ? 'down' : null,
    ...(pingToken ? { ping_url: pingUrlFor(event, pingToken) } : {}),
  }
})
