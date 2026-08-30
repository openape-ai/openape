import { defineEventHandler, getQuery } from 'h3'
import { eventsWindow } from '#shared/graph-live'
import { listEvents } from '../../utils/graph'
import { requireGraphAccess } from '../../utils/graph-account'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const graph = await requireGraphAccess(caller.email)
  const q = getQuery(event)
  const fallback = eventsWindow()
  const start = String(q.start ?? '') || fallback.start
  const end = String(q.end ?? '') || fallback.end
  const data = await listEvents(graph.accessToken, start, end)
  return (data.value ?? []).map(row => ({
    id: row.id,
    subject: row.subject || '(ohne Titel)',
    start: row.start?.dateTime || null,
    end: row.end?.dateTime || null,
    web_url: row.webLink || null,
    join_url: row.onlineMeeting?.joinUrl || null,
    location: row.location?.displayName || null,
    organizer: row.organizer?.emailAddress?.address || null,
  }))
})
