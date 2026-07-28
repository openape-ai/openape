import { randomUUID } from 'node:crypto'
import { useDb } from '../../../../database/drizzle'
import { memory } from '../../../../database/schema'
import { pickMode } from '../../../../utils/cockpit/memory-mode'
import { requireOwnedOrg } from '../../../../utils/cockpit/org-access'

const SCOPES = new Set(['company', 'role', 'agent'])

// Create a memory doc. `mode` is optional — omitted, it auto-picks inline/reference
// by body size (owner override wins). role/agent scope needs a targetId.
export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const body = await readBody<{ scope?: string, targetId?: string, title?: string, body?: string, mode?: string }>(event)
  const scope = (body?.scope ?? 'company').trim()
  if (!SCOPES.has(scope)) throw createError({ statusCode: 400, statusMessage: 'invalid scope' })
  const targetId = (body?.targetId ?? '').trim()
  if (scope !== 'company' && !targetId) throw createError({ statusCode: 400, statusMessage: 'targetId required for role/agent scope' })
  const text = body?.body ?? ''
  const mode = body?.mode === 'inline' || body?.mode === 'reference' ? body.mode : pickMode(text)
  const now = Date.now()
  const row = {
    id: randomUUID(),
    ownerEmail: owner,
    orgId,
    scope,
    targetId: scope === 'company' ? '' : targetId,
    title: (body?.title ?? '').trim(),
    body: text,
    mode,
    createdAt: now,
    updatedAt: now,
  }
  await useDb().insert(memory).values(row)
  return { id: row.id, scope: row.scope, targetId: row.targetId, title: row.title, body: row.body, mode: row.mode, updatedAt: row.updatedAt }
})
