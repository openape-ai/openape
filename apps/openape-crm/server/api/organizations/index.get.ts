import { asc, eq } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { useDb } from '../../database/drizzle'
import { organizations } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

/** GET /api/organizations?workspace_id=… — Firmen des Workspaces. */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const workspaceId = String(getQuery(event).workspace_id ?? '')
  if (!workspaceId) throw createProblemError({ status: 400, title: 'workspace_id required' })

  const db = useDb()
  await requireRole(db, workspaceId, caller.email)

  return await db
    .select({
      id: organizations.id,
      name: organizations.name,
      domain: organizations.domain,
      created_at: organizations.createdAt,
    })
    .from(organizations)
    .where(eq(organizations.workspaceId, workspaceId))
    .orderBy(asc(organizations.name))
    .all()
})
