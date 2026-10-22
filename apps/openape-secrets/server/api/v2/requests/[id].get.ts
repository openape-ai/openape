import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../database/drizzle'
import { secretAccessRequests, secretApprovals } from '../../../database/schema'
import { createProblemError } from '../../../utils/problem'
import { ownerRequestViews, requesterView } from '../../../utils/vault-requests'

/**
 * GET /api/v2/requests/:id — the owner sees what they decide on; the requester
 * sees only where its request stands. Anyone else gets 404.
 */
export default defineEventHandler(async (event) => {
  if (!useRuntimeConfig().vaultEnabled) throw createProblemError({ status: 404, title: 'Not found' })
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id') ?? ''
  const db = useDb()
  const row = await db.select().from(secretAccessRequests).where(eq(secretAccessRequests.id, id)).get()
  if (!row || (caller.email !== row.ownerEmail && caller.email !== row.requester)) throw createProblemError({ status: 404, title: 'Request not found' })

  const approval = await db.select().from(secretApprovals).where(eq(secretApprovals.requestId, row.id)).get()
  if (caller.email !== row.ownerEmail) return requesterView(row, approval?.id)
  const [view] = await ownerRequestViews([row])
  return {
    ...view,
    // The owner may ask for their own machine; `ape-secrets wait` reads the same field either way.
    ...(approval ? { approval_id: approval.id } : {}),
    approval: approval
      ? { id: approval.id, status: approval.status, mode: approval.mode, expires_at: approval.expiresAt, created_at: approval.createdAt, decided_at: row.decidedAt, collect_count: approval.collectCount, last_collected_at: approval.lastCollectedAt }
      : null,
  }
})
