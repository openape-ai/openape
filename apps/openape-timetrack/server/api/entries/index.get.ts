import { and, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { useDb } from '../../database/drizzle'
import { timeEntries } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { loadCallerRoleMaps } from '../../utils/rbac'
import { resolveEntryRights } from '../../utils/visibility'
import { serializeEntry } from '../../utils/entry-shape'

/**
 * GET /api/entries?company=&project=&from=&to=&mine= — entries the caller
 * may see per the §4 visibility matrix (filtered server-side).
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const q = getQuery(event) as {
    company?: string
    project?: string
    from?: string
    to?: string
    mine?: string
  }
  const db = useDb()
  const maps = await loadCallerRoleMaps(db, caller.email)

  const filters = [isNull(timeEntries.deletedAt)]
  if (q.project) filters.push(eq(timeEntries.projectId, q.project))
  else if (q.company) filters.push(eq(timeEntries.companyId, q.company))

  const rows = await db.select().from(timeEntries).where(and(...filters)).all()
  const onlyMine = q.mine === 'true' || q.mine === '1'

  return rows
    .filter((r) => {
      if (q.from && r.entryDate < q.from) return false
      if (q.to && r.entryDate > q.to) return false
      if (onlyMine && r.userEmail !== caller.email) return false
      const { canView } = resolveEntryRights(caller.email, { userEmail: r.userEmail }, {
        companyRole: maps.companyRoles.get(r.companyId),
        projectRole: maps.projectRoles.get(r.projectId),
      })
      return canView
    })
    .sort((a, b) => (a.entryDate < b.entryDate ? 1 : a.entryDate > b.entryDate ? -1 : b.createdAt - a.createdAt))
    .map(serializeEntry)
})
