import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../database/drizzle'
import { companies, companyMembers, projectMembers, projects } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'
import { resolveCompanyRole } from '../../utils/rbac'

/**
 * GET /api/companies/:id — company detail with the projects the caller may
 * see and (for company owner/manager) the member list.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'Missing company id' })

  const db = useDb()
  const company = await db.select().from(companies).where(eq(companies.id, id)).get()
  if (!company) throw createProblemError({ status: 404, title: 'Company not found' })

  const companyRole = await resolveCompanyRole(db, id, caller.email)

  const allProjects = await db.select().from(projects).where(eq(projects.companyId, id)).all()
  const myProjectIds = new Set(
    (await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userEmail, caller.email))
      .all()).map(r => r.projectId),
  )

  const seesAllProjects = companyRole === 'owner' || companyRole === 'manager'
  const visibleProjects = allProjects.filter(
    p => !p.archivedAt && (seesAllProjects || myProjectIds.has(p.id)),
  )

  if (!companyRole && visibleProjects.length === 0) {
    throw createProblemError({ status: 403, title: 'No access to this company' })
  }

  const members = (companyRole === 'owner' || companyRole === 'manager')
    ? await db.select().from(companyMembers).where(eq(companyMembers.companyId, id)).all()
    : []

  return {
    id: company.id,
    name: company.name,
    role: companyRole ?? null,
    created_at: company.createdAt,
    archived_at: company.archivedAt,
    projects: visibleProjects.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      archived_at: p.archivedAt,
      created_at: p.createdAt,
    })),
    members: members.map(m => ({ user_email: m.userEmail, role: m.role, joined_at: m.joinedAt })),
  }
})
