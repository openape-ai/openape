import { eq } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { useDb } from '../../database/drizzle'
import { projects } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'
import { loadCallerRoleMaps } from '../../utils/rbac'

/**
 * GET /api/projects?company=<id> — projects in a company visible to caller.
 * Visible = company owner/manager (all) OR project member/manager (that one).
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const { company } = getQuery(event) as { company?: string }
  if (!company) throw createProblemError({ status: 400, title: 'company query param required' })

  const db = useDb()
  const { companyRoles, projectRoles } = await loadCallerRoleMaps(db, caller.email)
  const companyRole = companyRoles.get(company)
  const seesAll = companyRole === 'owner' || companyRole === 'manager'

  const rows = await db.select().from(projects).where(eq(projects.companyId, company)).all()
  return rows
    .filter(p => !p.archivedAt && (seesAll || projectRoles.has(p.id)))
    .map(p => ({
      id: p.id,
      company_id: p.companyId,
      name: p.name,
      description: p.description,
      role: projectRoles.get(p.id) ?? null,
      created_at: p.createdAt,
      archived_at: p.archivedAt,
    }))
})
