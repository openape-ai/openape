// Helpers for the delegation_grants table.

import { and, eq, isNull } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { delegationGrants } from '../database/schema'

/** Resolve the active (not revoked) grant_id for (owner, audience), or null. */
export async function getActiveDelegationGrantId(owner: string, audience: string): Promise<string | null> {
  const db = useDb()
  const row = await db.select({ grantId: delegationGrants.grantId })
    .from(delegationGrants)
    .where(and(
      eq(delegationGrants.ownerEmail, owner.toLowerCase()),
      eq(delegationGrants.audience, audience),
      isNull(delegationGrants.revokedAt),
    ))
    .limit(1)
  return row[0]?.grantId ?? null
}

export async function upsertDelegationGrant(opts: { ownerEmail: string, audience: string, grantId: string }): Promise<void> {
  const db = useDb()
  const now = Math.floor(Date.now() / 1000)
  // Manual upsert — drizzle's onConflictDoUpdate works on libsql but
  // the wire shape here (clear revokedAt, set new grantId) is small
  // enough to express directly.
  await db.delete(delegationGrants)
    .where(and(
      eq(delegationGrants.ownerEmail, opts.ownerEmail.toLowerCase()),
      eq(delegationGrants.audience, opts.audience),
    ))
  await db.insert(delegationGrants).values({
    ownerEmail: opts.ownerEmail.toLowerCase(),
    audience: opts.audience,
    grantId: opts.grantId,
    createdAt: now,
  })
}

export async function revokeDelegationGrant(owner: string, audience: string): Promise<void> {
  const db = useDb()
  await db.update(delegationGrants)
    .set({ revokedAt: Math.floor(Date.now() / 1000) })
    .where(and(
      eq(delegationGrants.ownerEmail, owner.toLowerCase()),
      eq(delegationGrants.audience, audience),
    ))
}
