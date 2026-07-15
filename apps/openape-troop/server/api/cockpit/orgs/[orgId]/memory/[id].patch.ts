import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../../database/drizzle'
import { memory } from '../../../../../database/schema'
import { pickMode } from '../../../../../utils/cockpit/memory-mode'
import { requireOwnedOrg } from '../../../../../utils/cockpit/org-access'

const SCOPES = new Set(['company', 'role', 'agent'])

// Edit a memory doc — any subset of scope/targetId/title/body/mode. Editing the
// body without an explicit mode re-derives inline/reference from its new size.
export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  const body = await readBody<{ scope?: string, targetId?: string, title?: string, body?: string, mode?: string }>(event)
  const patch: Record<string, unknown> = {}
  if (typeof body?.scope === 'string') {
    if (!SCOPES.has(body.scope)) throw createError({ statusCode: 400, statusMessage: 'invalid scope' })
    patch.scope = body.scope
  }
  if (typeof body?.targetId === 'string') patch.targetId = body.targetId.trim()
  if (typeof body?.title === 'string') patch.title = body.title.trim()
  if (typeof body?.body === 'string') {
    patch.body = body.body
    if (body?.mode !== 'inline' && body?.mode !== 'reference') patch.mode = pickMode(body.body)
  }
  if (body?.mode === 'inline' || body?.mode === 'reference') patch.mode = body.mode
  if (Object.keys(patch).length === 0) throw createError({ statusCode: 400, statusMessage: 'no fields' })
  patch.updatedAt = Date.now()
  await useDb().update(memory).set(patch).where(and(eq(memory.id, id), eq(memory.ownerEmail, owner), eq(memory.orgId, orgId)))
  return { ok: true }
})
