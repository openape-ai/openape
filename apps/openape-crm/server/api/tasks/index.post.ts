import { eq } from 'drizzle-orm'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { deals, notes, tasks } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<{
    deal_id?: string
    title?: string
    description?: string
    due_at?: string | null
    assignee_email?: string
  }>(event)
  const dealId = body?.deal_id
  const title = body?.title?.trim()
  if (!dealId) throw createProblemError({ status: 400, title: 'deal_id required' })
  if (!title || title.length > 200) throw createProblemError({ status: 400, title: 'title must be 1–200 chars' })
  const db = useDb()
  const deal = await db.select().from(deals).where(eq(deals.id, dealId)).get()
  if (!deal) throw createProblemError({ status: 404, title: 'deal not found' })
  await requireRole(db, deal.workspaceId, caller.email)
  const id = ulid()
  const now = Date.now()
  const assignee = body?.assignee_email?.trim() || caller.email
  await db.insert(tasks).values({
    id,
    workspaceId: deal.workspaceId,
    dealId,
    title,
    description: body?.description?.trim() || null,
    dueAt: body?.due_at || null,
    assigneeEmail: assignee,
    status: 'offen',
    createdAt: now,
  })
  await db.insert(notes).values({
    id: ulid(),
    workspaceId: deal.workspaceId,
    dealId,
    authorEmail: caller.email,
    kind: 'aufgabe',
    title,
    body: body?.description?.trim() || title,
    createdAt: now,
  })
  setResponseStatus(event, 201)
  return { id, title, status: 'offen', assignee_email: assignee, due_at: body?.due_at || null }
})
