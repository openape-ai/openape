import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { cockpitHooks } from '../../../../database/schema'
import { requireOwnedOrg } from '../../../../utils/cockpit/org-access'

export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const rows = await useDb().select().from(cockpitHooks).where(and(eq(cockpitHooks.ownerEmail, owner), eq(cockpitHooks.orgId, orgId)))
  return rows.map(h => ({ id: h.id, label: h.label, token: h.token, secret: h.secret, prompt: h.prompt, includePayload: h.includePayload, enabled: h.enabled, createdBy: h.createdBy, lastFiredAt: h.lastFiredAt }))
})
