import { and, eq } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { cockpitSkills } from '../../database/schema'
import { cockpitOwner } from '../../utils/cockpit/auth'

// List the owner's library skills (org-agnostic: orgId=''), assignable to agents
// across companies.
export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const rows = await useDb().select().from(cockpitSkills).where(and(eq(cockpitSkills.ownerEmail, owner), eq(cockpitSkills.orgId, '')))
  return rows.map(s => ({ id: s.id, name: s.name, description: s.description, prompt: s.prompt, assignedTo: s.assignedTo, updatedAt: s.updatedAt }))
})
