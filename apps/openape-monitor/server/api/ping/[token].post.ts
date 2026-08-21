import { and, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { useDb } from '../../database/drizzle'
import { monitors } from '../../database/schema'
import { runCheck } from '../../utils/check'
import { createProblemError } from '../../utils/problem'

/**
 * POST /api/ping/:token — the dead man's switch.
 *
 * No session: the token in the path is the credential, which is the point —
 * the caller is a cron job on a machine that has no browser and no login.
 * Treat the token as a secret; whoever holds it can keep the monitor green.
 *
 * An unknown token is a plain 404, the same answer a wrong path would give.
 * A distinct 401/403 would tell a guesser which tokens exist.
 *
 * The ping re-evaluates the monitor immediately instead of leaving it to the
 * ticker, so recovery is visible (and mailed) the moment the process reports
 * in — waiting a full interval to say "it's back" is the kind of lag that
 * makes people stop trusting a status page.
 */
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')
  if (!token) throw createProblemError({ status: 404, title: 'Not found' })

  const db = useDb()
  const monitor = await db.select().from(monitors).where(and(eq(monitors.pingToken, token), eq(monitors.kind, 'heartbeat'))).get()
  if (!monitor) throw createProblemError({ status: 404, title: 'Not found' })

  const nowSec = Math.floor(Date.now() / 1000)
  await db.update(monitors).set({ lastPingAt: nowSec }).where(eq(monitors.id, monitor.id))

  const result = await runCheck({ ...monitor, lastPingAt: nowSec })

  setResponseStatus(event, 200)
  return { ok: true, status: result.up ? 'up' : 'down' }
})
