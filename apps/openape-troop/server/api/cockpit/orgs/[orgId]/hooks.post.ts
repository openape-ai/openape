import { randomBytes, randomUUID } from 'node:crypto'
import { useDb } from '../../../../database/drizzle'
import { cockpitHooks } from '../../../../database/schema'
import { requireOwnedOrg } from '../../../../utils/cockpit/org-access'

// Create an event hook for this org. Returns the generated token (the URL secret)
// and, if requested, an HMAC secret — both shown so the owner can wire the sender.
export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const body = await readBody<{ label?: string, prompt?: string, includePayload?: boolean, useSecret?: boolean }>(event)
  const prompt = (body?.prompt ?? '').trim()
  if (!prompt) throw createError({ statusCode: 400, statusMessage: 'prompt required' })
  const row = {
    id: randomUUID(),
    ownerEmail: owner,
    orgId,
    label: (body?.label ?? '').trim(),
    token: randomBytes(24).toString('base64url'),
    secret: body?.useSecret ? randomBytes(32).toString('hex') : null,
    prompt,
    includePayload: body?.includePayload === true,
    enabled: true,
    lastFiredAt: null,
    createdAt: Date.now(),
  }
  await useDb().insert(cockpitHooks).values(row)
  return { id: row.id, label: row.label, token: row.token, secret: row.secret, prompt: row.prompt, includePayload: row.includePayload, enabled: true }
})
