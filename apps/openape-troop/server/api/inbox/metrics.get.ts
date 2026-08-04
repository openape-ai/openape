import { and, asc, eq, gte } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { attentionEvents } from '../../database/schema'
import { agentRecords, metricsFromEvents } from '../../../app/utils/attention-metrics'
import { parseSince, resolveEventOwner, toWire } from '../../utils/attention-events'

const MAX_EVENTS = 5000

// Metrics and per-agent track records, folded from the caller's own event log.
// Nothing is stored: change the window, get a different answer from the same
// events. `?since=` accepts unix seconds or -7d/-24h; default is everything.
export default defineEventHandler(async (event) => {
  const ownerEmail = await resolveEventOwner(event)
  const since = parseSince(String(getQuery(event).since ?? ''), Math.floor(Date.now() / 1000))

  const filters = [eq(attentionEvents.ownerEmail, ownerEmail)]
  if (since !== null) filters.push(gte(attentionEvents.ts, since))

  const rows = await useDb().select().from(attentionEvents).where(and(...filters)).orderBy(asc(attentionEvents.ts), asc(attentionEvents.id)).limit(MAX_EVENTS)
  const events = rows.map(toWire)

  return {
    metrics: metricsFromEvents(events),
    agents: agentRecords(events),
    events_considered: events.length,
    truncated: rows.length === MAX_EVENTS,
  }
})
