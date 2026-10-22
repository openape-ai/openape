import { eq, sql } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../database/drizzle'
import { secretApprovals } from '../../../database/schema'
import { createProblemError } from '../../../utils/problem'
import { approvalStatus, currentVersionOf } from '../../../utils/vault-requests'

/**
 * GET /api/v2/approvals/:id — what the requester needs before collecting:
 * which machine key the package is sealed for, the mode and whether it can
 * still be collected. Lets a CLI find its key before it uses up a one-time
 * approval. No package, no signature.
 */
export default defineEventHandler(async (event) => {
  if (!useRuntimeConfig().vaultEnabled) throw createProblemError({ status: 404, title: 'Not found' })
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id') ?? ''
  const db = useDb()
  const row = await db.select().from(secretApprovals).where(eq(secretApprovals.id, id)).get()
  if (!row || (caller.email !== row.requester && caller.email !== row.ownerEmail)) throw createProblemError({ status: 404, title: 'Approval not found' })
  const current = await db.get<{ v: number | null }>(sql`SELECT ${currentVersionOf} AS v FROM secret_approvals WHERE id = ${id}`)
  return {
    id: row.id,
    status: approvalStatus(row, current?.v ?? null),
    mode: row.mode,
    expires_at: row.expiresAt,
    consumer_id: row.consumerId,
    consumer_key_fingerprint: row.consumerFingerprint,
    secret: { id: row.secretId, version: row.secretVersion },
    collect_count: row.collectCount,
  }
})
