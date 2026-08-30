import { desc, eq } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { useDb } from '../../database/drizzle'
import { threads } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const workspaceId = String(getQuery(event).workspace_id ?? '')
  if (!workspaceId) throw createProblemError({ status: 400, title: 'workspace_id required' })
  const db = useDb()
  await requireRole(db, workspaceId, caller.email)
  const status = String(getQuery(event).status ?? '')
  const rows = await db
    .select({
      id: threads.id,
      deal_id: threads.dealId,
      subject: threads.subject,
      status: threads.status,
      source: threads.source,
      created_at: threads.createdAt,
    })
    .from(threads)
    .where(eq(threads.workspaceId, workspaceId))
    .orderBy(desc(threads.createdAt))
    .all()
  return status ? rows.filter(r => r.status === status) : rows
})
