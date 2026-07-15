import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { memory } from '../../../../database/schema'
import { requireOwnedOrg } from '../../../../utils/cockpit/org-access'

// List the org's memory docs (owner-gated).
export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const rows = await useDb().select().from(memory).where(and(eq(memory.orgId, orgId), eq(memory.ownerEmail, owner)))
  return rows.map(m => ({ id: m.id, scope: m.scope, targetId: m.targetId, title: m.title, body: m.body, mode: m.mode, updatedAt: m.updatedAt }))
})
