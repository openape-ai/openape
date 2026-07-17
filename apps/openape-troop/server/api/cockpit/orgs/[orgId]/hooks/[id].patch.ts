import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../../database/drizzle'
import { cockpitHooks } from '../../../../../database/schema'
import { requireOwnedOrg } from '../../../../../utils/cockpit/org-access'

// Edit a hook — any subset of label/prompt/includePayload/enabled. Token/secret
// are immutable (rotate by deleting + recreating).
export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  const body = await readBody<{ label?: string, prompt?: string, includePayload?: boolean, enabled?: boolean }>(event)
  const patch: Record<string, unknown> = {}
  if (typeof body?.label === 'string') patch.label = body.label.trim()
  if (typeof body?.prompt === 'string') patch.prompt = body.prompt.trim()
  if (typeof body?.includePayload === 'boolean') patch.includePayload = body.includePayload
  if (typeof body?.enabled === 'boolean') patch.enabled = body.enabled
  if (Object.keys(patch).length === 0) throw createError({ statusCode: 400, statusMessage: 'no fields' })
  await useDb().update(cockpitHooks).set(patch).where(and(eq(cockpitHooks.id, id), eq(cockpitHooks.ownerEmail, owner), eq(cockpitHooks.orgId, orgId)))
  return { ok: true }
})
