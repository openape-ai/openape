import { randomUUID } from 'node:crypto'
import { useDb } from '../../../../database/drizzle'
import { cockpitSchedules } from '../../../../database/schema'
import { requireOwnedOrg } from '../../../../utils/cockpit/org-access'
import { isValidCron } from '../../../../utils/cockpit/schedule'

// Define a proactive trigger for this org. Timing is one of: cron expression
// (cronExpr, 5-field, Vienna) | daily (atHour) | periodic (everyMinutes) |
// one-shot timer (fireAt, epoch ms). `prompt` is what the Operator does when due.
// The 15s evaluator enqueues it; the answer lands in the cockpit chat + Web-Push.
export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const body = await readBody<{ kind?: string, prompt?: string, atHour?: number, everyMinutes?: number, fireAt?: number, cronExpr?: string }>(event)
  const kind = (body?.kind ?? '').trim()
  if (!kind) throw createError({ statusCode: 400, statusMessage: 'kind required' })
  const prompt = (body?.prompt ?? '').trim()
  if (!prompt) throw createError({ statusCode: 400, statusMessage: 'prompt required' })
  const atHour = typeof body?.atHour === 'number' ? Math.max(0, Math.min(23, Math.floor(body.atHour))) : null
  const everyMinutes = typeof body?.everyMinutes === 'number' && body.everyMinutes > 0 ? Math.floor(body.everyMinutes) : null
  const fireAt = typeof body?.fireAt === 'number' && body.fireAt > 0 ? Math.floor(body.fireAt) : null
  const cronExpr = typeof body?.cronExpr === 'string' && body.cronExpr.trim() ? body.cronExpr.trim() : null
  if (cronExpr != null && !isValidCron(cronExpr)) throw createError({ statusCode: 400, statusMessage: 'invalid cron expression (5-field, e.g. "0 7 * * 1-5")' })
  if (atHour == null && everyMinutes == null && fireAt == null && cronExpr == null) throw createError({ statusCode: 400, statusMessage: 'cronExpr, atHour, everyMinutes or fireAt required' })
  const row = { id: randomUUID(), ownerEmail: owner, orgId, kind, prompt, atHour, everyMinutes, fireAt, cronExpr, enabled: true, lastRunAt: null, createdAt: Date.now() }
  await useDb().insert(cockpitSchedules).values(row)
  return { id: row.id, kind, prompt, atHour, everyMinutes, fireAt, cronExpr, enabled: true }
})
