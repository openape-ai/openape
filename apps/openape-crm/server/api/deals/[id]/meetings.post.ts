import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../database/drizzle'
import { deals, notes } from '../../../database/schema'
import { buildEventBody, graphJson } from '../../../utils/graph'
import { requireGraphAccess } from '../../../utils/graph-account'
import { createProblemError } from '../../../utils/problem'
import { requireRole } from '../../../utils/workspace-access'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ subject?: string, start?: string, end?: string, attendees?: string[] }>(event)
  const subject = body?.subject?.trim()
  const start = body?.start?.trim()
  const end = body?.end?.trim()
  const attendees = (body?.attendees ?? []).map(s => s.trim()).filter(Boolean)
  if (!subject || !start || !end) throw createProblemError({ status: 400, title: 'subject, start and end required' })
  const db = useDb()
  const deal = await db.select().from(deals).where(eq(deals.id, id)).get()
  if (!deal) throw createProblemError({ status: 404, title: 'deal not found' })
  await requireRole(db, deal.workspaceId, caller.email)
  const graph = await requireGraphAccess(caller.email)
  const created = await graphJson<{ onlineMeeting?: { joinUrl?: string }, webLink?: string }>(
    graph.accessToken,
    '/me/events',
    {
      method: 'POST',
      body: JSON.stringify(buildEventBody({ subject, start, end, attendees })),
    },
  )
  const join = created.onlineMeeting?.joinUrl || created.webLink || ''
  const now = Date.now()
  await db.insert(notes).values({
    id: ulid(),
    workspaceId: deal.workspaceId,
    dealId: deal.id,
    authorEmail: caller.email,
    kind: 'termin',
    title: subject,
    body: join ? `Teams: ${join}` : 'Termin angelegt.',
    createdAt: now,
  })
  return { ok: true, join_url: join || null }
})
