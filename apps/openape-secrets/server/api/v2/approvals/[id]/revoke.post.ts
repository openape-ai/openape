import { and, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../../database/drizzle'
import { secretApprovals } from '../../../../database/schema'
import { createProblemError } from '../../../../utils/problem'
import { requireVaultOwner } from '../../../../utils/vault-owner'
import { nowSec } from '../../../../utils/vault-passkeys'

/**
 * POST /api/v2/approvals/:id/revoke — stop all future collections. Only removes
 * access, so the session suffices. A value a machine already collected stays
 * where it is; the response says so rather than promising otherwise.
 */
export default defineEventHandler(async (event) => {
  const owner = await requireVaultOwner(event)
  const id = getRouterParam(event, 'id') ?? ''
  const db = useDb()
  const row = await db.select().from(secretApprovals).where(and(eq(secretApprovals.id, id), eq(secretApprovals.ownerEmail, owner))).get()
  if (!row) throw createProblemError({ status: 404, title: 'Approval not found' })
  if (row.status !== 'active') throw createProblemError({ status: 409, title: `This approval is already ${row.status}` })
  await db.update(secretApprovals).set({ status: 'revoked', revokedAt: nowSec() }).where(and(eq(secretApprovals.id, id), eq(secretApprovals.status, 'active')))
  return { id, status: 'revoked' }
})
