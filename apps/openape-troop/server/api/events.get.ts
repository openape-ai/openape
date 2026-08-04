import { and, desc, eq, gte } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { attentionEvents } from '../database/schema'
import { parseSince, resolveEventOwner, toWire } from '../utils/attention-events'

const MAX_EVENTS = 500

// Query the caller's attention events, oldest first. Owner-scoped: an agent
// bearer reads its owner's log (same resolution as the write path). Filters:
// ?task_ref= exact match, ?type= exact match, ?since= unix seconds or -1h/-30m/-2d.
//
// The limit is applied to the NEWEST events, then flipped back to chronological
// order. Taking the oldest 500 would have quietly hidden every new decision as
// soon as the log passed the limit — the inbox would look empty while cards
// piled up.
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

  const newestFirst = await useDb().select().from(attentionEvents).where(and(...filters)).orderBy(desc(attentionEvents.ts), desc(attentionEvents.id)).limit(MAX_EVENTS)
  const rows = newestFirst.reverse()

  return {
    events: rows.map(toWire),
    truncated: rows.length === MAX_EVENTS,
  }
})
