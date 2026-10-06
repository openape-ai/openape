import { asc, eq } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { useDb } from '../../database/drizzle'
import { contacts, deals, organizations } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

/** GET /api/deals?workspace_id=… — alle Deals eines Workspaces, board-fertig sortiert. */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const workspaceId = String(getQuery(event).workspace_id ?? '')
  if (!workspaceId) throw createProblemError({ status: 400, title: 'workspace_id required' })

  const db = useDb()
  await requireRole(db, workspaceId, caller.email)

  return await db
    .select({
      id: deals.id,
      title: deals.title,
      value_cents: deals.valueCents,
      stage: deals.stage,
      position: deals.position,
      contact_id: deals.contactId,
      contact_name: contacts.name,
      org_id: deals.orgId,
      org_name: organizations.name,
      created_at: deals.createdAt,
      closed_at: deals.closedAt,
    })
    .from(deals)
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .leftJoin(organizations, eq(organizations.id, deals.orgId))
    .where(eq(deals.workspaceId, workspaceId))
    .orderBy(asc(deals.position), asc(deals.createdAt))
    .all()
})
