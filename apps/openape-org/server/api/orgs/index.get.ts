import { desc, eq, sql } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { orgMembers, organizations } from '../../database/schema'
import { requireOwner } from '../../utils/auth'

// List all orgs this owner has. Includes a cheap member-count subquery
// so the list view can show "5 members" badges without N+1.
export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const db = useDb()

  return db
    .select({
      id: organizations.id,
      name: organizations.name,
      visionMd: organizations.visionMd,
      budgetMonthlyEur: organizations.budgetMonthlyEur,
      createdAt: organizations.createdAt,
      updatedAt: organizations.updatedAt,
      memberCount: sql<number>`(SELECT COUNT(*) FROM ${orgMembers} WHERE ${orgMembers.orgId} = ${organizations.id} AND ${orgMembers.status} != 'retired')`,
    })
    .from(organizations)
    .where(eq(organizations.ownerEmail, owner.toLowerCase()))
    .orderBy(desc(organizations.createdAt))
})
