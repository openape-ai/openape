import { asc, eq } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { useDb } from '../../database/drizzle'
import { contacts, organizations } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

/** GET /api/contacts?workspace_id=… — Kontakte samt Firmenname. */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const workspaceId = String(getQuery(event).workspace_id ?? '')
  if (!workspaceId) throw createProblemError({ status: 400, title: 'workspace_id required' })

  const db = useDb()
  await requireRole(db, workspaceId, caller.email)

  return await db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      phone: contacts.phone,
      org_id: contacts.orgId,
      org_name: organizations.name,
      created_at: contacts.createdAt,
    })
    .from(contacts)
    .leftJoin(organizations, eq(organizations.id, contacts.orgId))
    .where(eq(contacts.workspaceId, workspaceId))
    .orderBy(asc(contacts.name))
    .all()
})
