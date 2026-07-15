import { randomUUID } from 'node:crypto'
import { useDb } from '../../../../database/drizzle'
import { cockpitSkills } from '../../../../database/schema'
import { requireOwnedOrg } from '../../../../utils/cockpit/org-access'
import { validateAssignedTo } from '../../../../utils/cockpit/skill-assign'

// Create a skill. `assignedTo` targets (agents/'ceo') are validated against the org.
export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const body = await readBody<{ name?: string, description?: string, prompt?: string, assignedTo?: unknown }>(event)
  const name = (body?.name ?? '').trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: 'name required' })
  const assignedTo = await validateAssignedTo(owner, orgId, body?.assignedTo ?? [])
  const now = Date.now()
  const row = {
    id: randomUUID(),
    ownerEmail: owner,
    orgId,
    name,
    description: (body?.description ?? '').trim(),
    prompt: body?.prompt ?? '',
    assignedTo,
    createdAt: now,
    updatedAt: now,
  }
  await useDb().insert(cockpitSkills).values(row)
  return { id: row.id, name: row.name, description: row.description, prompt: row.prompt, assignedTo: row.assignedTo, updatedAt: row.updatedAt }
})
