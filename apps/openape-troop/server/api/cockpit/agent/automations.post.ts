import { randomBytes, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../database/drizzle'
import { cockpitHooks, cockpitSchedules } from '../../../database/schema'
import { requireAgentOrg } from '../../../utils/cockpit/agent-org'

// The Operator's self-scheduling surface. One action-dispatched endpoint (a single
// auditable surface) the worker calls with its owner-resolving DDISA identity to
// manage the automations of an org it owns. Everything it creates is stamped
// createdBy='operator' so the owner can see (and review) what the Operator set up
// for itself. Actions: create-schedule | create-hook | list | update | delete.
interface Body {
  action?: string
  orgId?: string
  // create-schedule
  kind?: string
  prompt?: string
  atHour?: number
  everyMinutes?: number
  fireAt?: number
  // create-hook
  label?: string
  includePayload?: boolean
  useSecret?: boolean
  // update/delete
  type?: 'schedule' | 'hook'
  id?: string
  enabled?: boolean
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  const orgId = body?.orgId ?? ''
  const owner = await requireAgentOrg(event, orgId)
  const db = useDb()
  const action = body?.action ?? ''

  if (action === 'create-schedule') {
    const kind = (body.kind ?? '').trim()
    const prompt = (body.prompt ?? '').trim()
    if (!kind || !prompt) throw createError({ statusCode: 400, statusMessage: 'kind and prompt required' })
    const atHour = typeof body.atHour === 'number' ? Math.max(0, Math.min(23, Math.floor(body.atHour))) : null
    const everyMinutes = typeof body.everyMinutes === 'number' && body.everyMinutes > 0 ? Math.floor(body.everyMinutes) : null
    const fireAt = typeof body.fireAt === 'number' && body.fireAt > 0 ? Math.floor(body.fireAt) : null
    if (atHour == null && everyMinutes == null && fireAt == null) throw createError({ statusCode: 400, statusMessage: 'atHour, everyMinutes or fireAt required' })
    const id = randomUUID()
    await db.insert(cockpitSchedules).values({ id, ownerEmail: owner, orgId, kind, prompt, atHour, everyMinutes, fireAt, enabled: true, createdBy: 'operator', lastRunAt: null, createdAt: Date.now() })
    return { id }
  }

  if (action === 'create-hook') {
    const prompt = (body.prompt ?? '').trim()
    if (!prompt) throw createError({ statusCode: 400, statusMessage: 'prompt required' })
    const id = randomUUID()
    const token = randomBytes(24).toString('base64url')
    const secret = body.useSecret ? randomBytes(32).toString('hex') : null
    await db.insert(cockpitHooks).values({ id, ownerEmail: owner, orgId, label: (body.label ?? '').trim(), token, secret, prompt, includePayload: body.includePayload === true, enabled: true, createdBy: 'operator', lastFiredAt: null, createdAt: Date.now() })
    return { id, token, secret }
  }

  if (action === 'list') {
    const schedules = await db.select().from(cockpitSchedules).where(and(eq(cockpitSchedules.ownerEmail, owner), eq(cockpitSchedules.orgId, orgId)))
    const hooks = await db.select().from(cockpitHooks).where(and(eq(cockpitHooks.ownerEmail, owner), eq(cockpitHooks.orgId, orgId)))
    return {
      schedules: schedules.map(s => ({ id: s.id, kind: s.kind, prompt: s.prompt, atHour: s.atHour, everyMinutes: s.everyMinutes, fireAt: s.fireAt, enabled: s.enabled, createdBy: s.createdBy, lastRunAt: s.lastRunAt })),
      hooks: hooks.map(h => ({ id: h.id, label: h.label, token: h.token, prompt: h.prompt, includePayload: h.includePayload, enabled: h.enabled, createdBy: h.createdBy, lastFiredAt: h.lastFiredAt })),
    }
  }

  if (action === 'update') {
    const id = body.id ?? ''
    if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
    const patch: Record<string, unknown> = {}
    if (typeof body.prompt === 'string') patch.prompt = body.prompt.trim()
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
    if (Object.keys(patch).length === 0) throw createError({ statusCode: 400, statusMessage: 'no fields' })
    if (body.type === 'hook') await db.update(cockpitHooks).set(patch).where(and(eq(cockpitHooks.id, id), eq(cockpitHooks.ownerEmail, owner), eq(cockpitHooks.orgId, orgId)))
    else await db.update(cockpitSchedules).set(patch).where(and(eq(cockpitSchedules.id, id), eq(cockpitSchedules.ownerEmail, owner), eq(cockpitSchedules.orgId, orgId)))
    return { ok: true }
  }

  if (action === 'delete') {
    const id = body.id ?? ''
    if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
    if (body.type === 'hook') await db.delete(cockpitHooks).where(and(eq(cockpitHooks.id, id), eq(cockpitHooks.ownerEmail, owner), eq(cockpitHooks.orgId, orgId)))
    else await db.delete(cockpitSchedules).where(and(eq(cockpitSchedules.id, id), eq(cockpitSchedules.ownerEmail, owner), eq(cockpitSchedules.orgId, orgId)))
    return { ok: true }
  }

  throw createError({ statusCode: 400, statusMessage: 'unknown action' })
})
