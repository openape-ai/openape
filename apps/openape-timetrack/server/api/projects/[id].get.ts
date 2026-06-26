import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../database/drizzle'
import { projectMembers, projects } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'
import { resolveProjectContext } from '../../utils/rbac'

/**
 * GET /api/projects/:id — project detail + member list (for project
 * manager / company owner|manager). Visible if any role resolves.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'Missing project id' })

  const db = useDb()
  const project = await db.select().from(projects).where(eq(projects.id, id)).get()
  if (!project) throw createProblemError({ status: 404, title: 'Project not found' })

  const ctx = await resolveProjectContext(db, id, caller.email)
  const visible = ctx && (
    ctx.companyRole === 'owner' || ctx.companyRole === 'manager'
    || ctx.projectRole === 'manager' || ctx.projectRole === 'member'
  )
  if (!visible) throw createProblemError({ status: 403, title: 'No access to this project' })

  const canSeeMembers = ctx!.companyRole === 'owner' || ctx!.companyRole === 'manager' || ctx!.projectRole === 'manager'
  const members = canSeeMembers
    ? await db.select().from(projectMembers).where(eq(projectMembers.projectId, id)).all()
    : []

  return {
    id: project.id,
    company_id: project.companyId,
    name: project.name,
    description: project.description,
    role: ctx!.projectRole ?? null,
    company_role: ctx!.companyRole ?? null,
    created_at: project.createdAt,
    archived_at: project.archivedAt,
    members: members.map(m => ({ user_email: m.userEmail, role: m.role, joined_at: m.joinedAt })),
  }
})
