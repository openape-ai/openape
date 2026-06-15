import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { orgMembers } from '../../../../database/schema'
import { requireOwnedOrg } from '../../../../utils/orgs'

// Soft-retire (not hard-delete) so the org-chart history stays
// reconstructable from the row + retiredAt timestamp.
export default defineEventHandler(async (event) => {
  const { org } = await requireOwnedOrg(event)
  const email = getRouterParam(event, 'email')
  if (!email) throw createError({ statusCode: 400, statusMessage: 'member email required' })

  const db = useDb()
  await db.update(orgMembers).set({ status: 'retired', retiredAt: Math.floor(Date.now() / 1000) }).where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.agentEmail, email)))
  return { ok: true }
})
