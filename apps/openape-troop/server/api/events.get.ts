import { and, asc, eq, gte } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { attentionEvents } from '../database/schema'
import { parseSince, resolveEventOwner } from '../utils/attention-events'

const MAX_EVENTS = 500

// Query the caller's attention events, oldest first. Owner-scoped: an agent
// bearer reads its owner's log (same resolution as the write path). Filters:
// ?task_ref= exact match, ?type= exact match, ?since= unix seconds or -1h/-30m/-2d.
export default defineEventHandler(async (event) => {
  const ownerEmail = await resolveEventOwner(event)
  const query = getQuery(event)

  const filters = [eq(attentionEvents.ownerEmail, ownerEmail)]
  if (typeof query.task_ref === 'string' && query.task_ref) {
    filters.push(eq(attentionEvents.taskRef, query.task_ref))
  }
  if (typeof query.type === 'string' && query.type) {
    filters.push(eq(attentionEvents.type, query.type))
  }
  const since = parseSince(typeof query.since === 'string' ? query.since : undefined, Math.floor(Date.now() / 1000))
  if (since !== null) {
    filters.push(gte(attentionEvents.ts, since))
  }

  const rows = await useDb().select().from(attentionEvents).where(and(...filters)).orderBy(asc(attentionEvents.ts), asc(attentionEvents.id)).limit(MAX_EVENTS)

  return {
    events: rows.map(row => ({
      id: row.id,
      ts: row.ts,
      actor: row.actor,
      actor_kind: row.actorKind,
      task_ref: row.taskRef,
      ...(row.goalRef ? { goal_ref: row.goalRef } : {}),
      ...(row.orgId ? { org_id: row.orgId } : {}),
      type: row.type,
      payload: row.payload,
    })),
    truncated: rows.length === MAX_EVENTS,
  }
})
