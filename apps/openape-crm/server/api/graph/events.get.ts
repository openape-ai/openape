import { defineEventHandler } from 'h3'
import { eventsWindow } from '#shared/graph-live'
import { listEvents } from '../../utils/graph'
import { requireGraphAccess } from '../../utils/graph-account'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const graph = await requireGraphAccess(caller.email)
  const win = eventsWindow()
  const data = await listEvents(graph.accessToken, win.start, win.end)
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
