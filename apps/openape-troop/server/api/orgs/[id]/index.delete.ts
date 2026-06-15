import { eq } from 'drizzle-orm'
import { useDb } from '../../../database/drizzle'
import { costSnapshots, objectives, orgMembers, organizations, reports } from '../../../database/schema'
import { requireOwnedOrg } from '../../../utils/orgs'

// Hard-delete cascade — wipes all child rows. Owner is the only one who
// can do this and they typed the org name to confirm (UI side).
export default defineEventHandler(async (event) => {
  const { org } = await requireOwnedOrg(event)
  const db = useDb()
  await db.delete(reports).where(eq(reports.orgId, org.id))
  await db.delete(objectives).where(eq(objectives.orgId, org.id))
  await db.delete(orgMembers).where(eq(orgMembers.orgId, org.id))
  await db.delete(costSnapshots).where(eq(costSnapshots.orgId, org.id))
  await db.delete(organizations).where(eq(organizations.id, org.id))
  return { ok: true }
})
