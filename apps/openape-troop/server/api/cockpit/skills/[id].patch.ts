import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../database/drizzle'
import { cockpitSkills } from '../../../database/schema'
import { cockpitOwner } from '../../../utils/cockpit/auth'
import { validateOwnerAssignedTo } from '../../../utils/cockpit/skill-assign'

// Edit a library skill — any subset of name/description/prompt/assignedTo. Owner-gated,
// library-only (orgId='').
export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  const body = await readBody<{ name?: string, description?: string, prompt?: string, assignedTo?: unknown }>(event)
  const patch: Record<string, unknown> = {}
  if (typeof body?.name === 'string') patch.name = body.name.trim()
  if (typeof body?.description === 'string') patch.description = body.description.trim()
  if (typeof body?.prompt === 'string') patch.prompt = body.prompt
  if ('assignedTo' in (body ?? {})) patch.assignedTo = await validateOwnerAssignedTo(owner, body.assignedTo)
  if (Object.keys(patch).length === 0) throw createError({ statusCode: 400, statusMessage: 'no fields' })
  patch.updatedAt = Date.now()
  await useDb().update(cockpitSkills).set(patch).where(and(eq(cockpitSkills.id, id), eq(cockpitSkills.ownerEmail, owner), eq(cockpitSkills.orgId, '')))
  return { ok: true }
})
