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

  const approval = await db.select({ id: secretApprovals.id, mode: secretApprovals.mode, expiresAt: secretApprovals.expiresAt, createdAt: secretApprovals.createdAt })
    .from(secretApprovals)
    .where(eq(secretApprovals.requestId, row.id))
    .get()
  if (caller.email !== row.ownerEmail) return requesterView(row, approval?.id)
  const [view] = await ownerRequestViews([row])
  return { ...view, approval: approval ? { id: approval.id, mode: approval.mode, expires_at: approval.expiresAt, created_at: approval.createdAt, decided_at: row.decidedAt } : null }
})
