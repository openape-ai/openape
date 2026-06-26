import { eq, isNull } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useDb } from '../../database/drizzle'
import { companies, projects } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { loadCallerRoleMaps } from '../../utils/rbac'
import { canLogToProject } from '../../utils/visibility'

/**
 * GET /api/me/projects — every (active) project the caller may log time on,
 * across all companies. Feeds the project picker in the personal /me view.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const db = useDb()
  const maps = await loadCallerRoleMaps(db, caller.email)

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      companyId: projects.companyId,
      companyName: companies.name,
      archivedAt: projects.archivedAt,
    })
    .from(projects)
    .innerJoin(companies, eq(companies.id, projects.companyId))
    .where(isNull(projects.archivedAt))
    .all()

  return rows
    .filter(p => canLogToProject({
      companyRole: maps.companyRoles.get(p.companyId),
      projectRole: maps.projectRoles.get(p.id),
    }))
    .map(p => ({
      id: p.id,
      name: p.name,
      company_id: p.companyId,
      company_name: p.companyName,
    }))
    .sort((a, b) => `${a.company_name}/${a.name}`.localeCompare(`${b.company_name}/${b.name}`))
})
