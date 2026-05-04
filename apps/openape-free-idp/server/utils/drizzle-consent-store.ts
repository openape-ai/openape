import type { ConsentStore } from '@openape/auth'
import { and, desc, eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { consents } from '../database/schema'

/**
 * Drizzle-backed ConsentStore for the DDISA `allowlist-user` policy
 * mode (#301). One row per (user, SP) pair; re-approval is an upsert,
 * revocation is a DELETE.
 */
export function createDrizzleConsentStore(): ConsentStore {
  const db = useDb()

  function lower(s: string): string {
    return s.toLowerCase()
  }

  return {
    async hasConsent(userId, clientId) {
      const row = await db
        .select({ userEmail: consents.userEmail })
        .from(consents)
        .where(and(eq(consents.userEmail, lower(userId)), eq(consents.clientId, lower(clientId))))
        .get()
      return !!row
    },

    async save(entry) {
      const userEmail = lower(entry.userId)
      const clientId = lower(entry.clientId)
      await db
        .insert(consents)
        .values({ userEmail, clientId, grantedAt: entry.grantedAt })
        .onConflictDoUpdate({
          target: [consents.userEmail, consents.clientId],
          set: { grantedAt: entry.grantedAt },
        })
    },

    async list(userId) {
      const rows = await db
        .select()
        .from(consents)
        .where(eq(consents.userEmail, lower(userId)))
        .orderBy(desc(consents.grantedAt))
      return rows.map(r => ({
        userId: r.userEmail,
        clientId: r.clientId,
        grantedAt: r.grantedAt,
      }))
    },

    async revoke(userId, clientId) {
      await db
        .delete(consents)
        .where(and(eq(consents.userEmail, lower(userId)), eq(consents.clientId, lower(clientId))))
    },
  }
}
