import { asc, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../database/drizzle'
import { workspaceMembers } from '../../../database/schema'
import { requireRole } from '../../../utils/workspace-access'

/** GET /api/workspaces/:id/members — Mitglieder samt Rolle. */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const workspaceId = getRouterParam(event, 'id')!
  const db = useDb()

  await requireRole(db, workspaceId, caller.email)

  return await db
    .select({
      user_email: workspaceMembers.userEmail,
      role: workspaceMembers.role,
      joined_at: workspaceMembers.joinedAt,
    })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.joinedAt))
    .all()
})
