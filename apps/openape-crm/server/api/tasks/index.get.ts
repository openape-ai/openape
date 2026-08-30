import { and, eq } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { useDb } from '../../database/drizzle'
import { deals, tasks } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const q = getQuery(event)
  const workspaceId = String(q.workspace_id ?? '')
  const dealId = q.deal_id ? String(q.deal_id) : ''
  if (!workspaceId && !dealId) throw createProblemError({ status: 400, title: 'workspace_id or deal_id required' })
  const db = useDb()
  if (dealId) {
    const deal = await db.select().from(deals).where(eq(deals.id, dealId)).get()
    if (!deal) throw createProblemError({ status: 404, title: 'deal not found' })
    await requireRole(db, deal.workspaceId, caller.email)
    return await db.select({
      id: tasks.id,
      deal_id: tasks.dealId,
      title: tasks.title,
      description: tasks.description,
      due_at: tasks.dueAt,
      assignee_email: tasks.assigneeEmail,
      status: tasks.status,
      created_at: tasks.createdAt,
    }).from(tasks).where(eq(tasks.dealId, dealId)).all()
  }
  await requireRole(db, workspaceId, caller.email)
  const status = q.status ? String(q.status) : ''
  const where = status
    ? and(eq(tasks.workspaceId, workspaceId), eq(tasks.status, status))
    : eq(tasks.workspaceId, workspaceId)
  return await db.select({
    id: tasks.id,
    deal_id: tasks.dealId,
    title: tasks.title,
    description: tasks.description,
    due_at: tasks.dueAt,
    assignee_email: tasks.assigneeEmail,
    status: tasks.status,
    created_at: tasks.createdAt,
  }).from(tasks).where(where).all()
})
