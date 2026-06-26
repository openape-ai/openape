import { eq } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { useDb } from '../database/drizzle'
import { companyMembers, projectMembers } from '../database/schema'
import { createProblemError } from '../utils/problem'
import { resolveCompanyRole, resolveProjectContext } from '../utils/rbac'

/**
 * GET /api/members?company=<id> | ?project=<id> — role overview.
 * Company list: visible to any company member. Project list: visible to
 * project members / company owner|manager.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const { company, project } = getQuery(event) as { company?: string, project?: string }
  const db = useDb()

  if (company) {
    const role = await resolveCompanyRole(db, company, caller.email)
    if (!role) throw createProblemError({ status: 403, title: 'Not a company member' })
    const rows = await db.select().from(companyMembers).where(eq(companyMembers.companyId, company)).all()
    return {
      scope: 'company' as const,
      members: rows.map(m => ({ user_email: m.userEmail, role: m.role, joined_at: m.joinedAt })),
    }
  }

  if (project) {
    const ctx = await resolveProjectContext(db, project, caller.email)
    const allowed = ctx && (
      ctx.companyRole === 'owner' || ctx.companyRole === 'manager'
      || ctx.projectRole === 'manager' || ctx.projectRole === 'member'
    )
    if (!allowed) throw createProblemError({ status: 403, title: 'No access to this project' })
    const rows = await db.select().from(projectMembers).where(eq(projectMembers.projectId, project)).all()
    return {
      scope: 'project' as const,
      members: rows.map(m => ({ user_email: m.userEmail, role: m.role, joined_at: m.joinedAt })),
    }
  }

  throw createProblemError({ status: 400, title: 'company or project query param required' })
})
