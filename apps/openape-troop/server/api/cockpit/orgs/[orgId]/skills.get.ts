import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { cockpitSkills } from '../../../../database/schema'
import { requireOwnedOrg } from '../../../../utils/cockpit/org-access'

// List the org's skills (owner-gated).
export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const rows = await useDb().select().from(cockpitSkills).where(and(eq(cockpitSkills.orgId, orgId), eq(cockpitSkills.ownerEmail, owner)))
  return rows.map(s => ({ id: s.id, name: s.name, description: s.description, prompt: s.prompt, assignedTo: s.assignedTo, updatedAt: s.updatedAt }))
})
