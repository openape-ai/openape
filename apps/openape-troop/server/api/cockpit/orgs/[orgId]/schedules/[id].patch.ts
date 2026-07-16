import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../../database/drizzle'
import { cockpitSchedules } from '../../../../../database/schema'
import { requireOwnedOrg } from '../../../../../utils/cockpit/org-access'

// Edit a trigger — any subset of kind/prompt/atHour/everyMinutes/fireAt/enabled.
// A timing change clears lastRunAt so the new schedule re-arms cleanly.
export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  const body = await readBody<{ kind?: string, prompt?: string, atHour?: number | null, everyMinutes?: number | null, fireAt?: number | null, enabled?: boolean }>(event)
  const patch: Record<string, unknown> = {}
  if (typeof body?.kind === 'string') patch.kind = body.kind.trim()
  if (typeof body?.prompt === 'string') patch.prompt = body.prompt.trim()
  if ('atHour' in (body ?? {})) patch.atHour = typeof body.atHour === 'number' ? Math.max(0, Math.min(23, Math.floor(body.atHour))) : null
  if ('everyMinutes' in (body ?? {})) patch.everyMinutes = typeof body.everyMinutes === 'number' && body.everyMinutes > 0 ? Math.floor(body.everyMinutes) : null
  if ('fireAt' in (body ?? {})) patch.fireAt = typeof body.fireAt === 'number' && body.fireAt > 0 ? Math.floor(body.fireAt) : null
  if (typeof body?.enabled === 'boolean') patch.enabled = body.enabled
  if (Object.keys(patch).length === 0) throw createError({ statusCode: 400, statusMessage: 'no fields' })
  if ('atHour' in patch || 'everyMinutes' in patch || 'fireAt' in patch) patch.lastRunAt = null
  await useDb().update(cockpitSchedules).set(patch).where(and(eq(cockpitSchedules.id, id), eq(cockpitSchedules.ownerEmail, owner), eq(cockpitSchedules.orgId, orgId)))
  return { ok: true }
})
