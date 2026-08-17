import { eq } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useDb } from '../../database/drizzle'
import { workspaceMembers, workspaces } from '../../database/schema'

/** GET /api/workspaces — die Workspaces, in denen der Aufrufer Mitglied ist. */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const db = useDb()

  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      role: workspaceMembers.role,
      created_at: workspaces.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userEmail, caller.email))
    .all()

  return rows
})
