import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../database/drizzle'
import { deals, notes } from '../../../database/schema'
import { buildSendMailBody, graphJson } from '../../../utils/graph'
import { requireGraphAccess } from '../../../utils/graph-account'
import { createProblemError } from '../../../utils/problem'
import { requireRole } from '../../../utils/workspace-access'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ to?: string[] | string, subject?: string, body?: string }>(event)
  const to = Array.isArray(body?.to)
    ? body.to.map(s => s.trim()).filter(Boolean)
    : (typeof body?.to === 'string' && body.to.trim() ? [body.to.trim()] : [])
  const subject = body?.subject?.trim()
  const text = body?.body?.trim()
  if (!to.length || !subject || !text) throw createProblemError({ status: 400, title: 'to, subject and body required' })
  const db = useDb()
  const deal = await db.select().from(deals).where(eq(deals.id, id)).get()
  if (!deal) throw createProblemError({ status: 404, title: 'deal not found' })
  await requireRole(db, deal.workspaceId, caller.email)
  const graph = await requireGraphAccess(caller.email)
  await graphJson(graph.accessToken, '/me/sendMail', {
    method: 'POST',
    body: JSON.stringify(buildSendMailBody({ to, subject, body: text })),
  })
  const now = Date.now()
  await db.insert(notes).values({
    id: ulid(),
    workspaceId: deal.workspaceId,
    dealId: deal.id,
    authorEmail: caller.email,
    kind: 'mail',
    title: subject,
    body: text,
    createdAt: now,
  })
  return { ok: true }
})
