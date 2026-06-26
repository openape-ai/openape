import { inArray, isNull } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useDb } from '../../database/drizzle'
import { companies } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { listVisibleCompanyIds, loadCallerRoleMaps } from '../../utils/rbac'

/**
 * GET /api/companies — companies the caller can see (company-member of, or
 * member of a project the company owns). `role` is the caller's company
 * role or null when access is only via a project.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const db = useDb()

  const visible = await listVisibleCompanyIds(db, caller.email)
  if (visible.size === 0) return []

  const ids = [...visible]
  const rows = await db
    .select()
    .from(companies)
    .where(inArray(companies.id, ids))
    .all()

  const { companyRoles } = await loadCallerRoleMaps(db, caller.email)

  return rows
    .filter(c => !c.archivedAt)
    .map(c => ({
      id: c.id,
      name: c.name,
      role: companyRoles.get(c.id) ?? null,
      created_at: c.createdAt,
      archived_at: c.archivedAt,
    }))
})
