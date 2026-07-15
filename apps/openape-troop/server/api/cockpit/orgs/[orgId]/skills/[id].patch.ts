import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../../database/drizzle'
import { cockpitSkills } from '../../../../../database/schema'
import { requireOwnedOrg } from '../../../../../utils/cockpit/org-access'
import { validateAssignedTo } from '../../../../../utils/cockpit/skill-assign'

// Edit a skill — any subset of name/description/prompt/assignedTo.
export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  const body = await readBody<{ name?: string, description?: string, prompt?: string, assignedTo?: unknown }>(event)
  const patch: Record<string, unknown> = {}
  if (typeof body?.name === 'string') patch.name = body.name.trim()
  if (typeof body?.description === 'string') patch.description = body.description.trim()
  if (typeof body?.prompt === 'string') patch.prompt = body.prompt
  if ('assignedTo' in (body ?? {})) patch.assignedTo = await validateAssignedTo(owner, orgId, body.assignedTo)
  if (Object.keys(patch).length === 0) throw createError({ statusCode: 400, statusMessage: 'no fields' })
  patch.updatedAt = Date.now()
  await useDb().update(cockpitSkills).set(patch).where(and(eq(cockpitSkills.id, id), eq(cockpitSkills.ownerEmail, owner), eq(cockpitSkills.orgId, orgId)))
  return { ok: true }
})
