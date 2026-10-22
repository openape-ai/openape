import { and, desc, eq, gt } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useDb } from '../../../database/drizzle'
import { secretAccessRequests } from '../../../database/schema'
import { requireVaultOwner } from '../../../utils/vault-owner'
import { nowSec } from '../../../utils/vault-passkeys'
import { ownerRequestViews } from '../../../utils/vault-requests'

/** GET /api/v2/requests — the owner's waiting requests, newest first. */
export default defineEventHandler(async (event) => {
  const owner = await requireVaultOwner(event)
  const rows = await useDb().select().from(secretAccessRequests).where(and(eq(secretAccessRequests.ownerEmail, owner), eq(secretAccessRequests.status, 'pending'), gt(secretAccessRequests.expiresAt, nowSec()))).orderBy(desc(secretAccessRequests.createdAt)).all()
  return ownerRequestViews(rows)
})
