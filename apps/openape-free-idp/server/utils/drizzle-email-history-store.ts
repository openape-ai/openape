import type { EmailHistoryStore } from '@openape/auth'
import { eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { emailHistory } from '../database/schema'

export function createDrizzleEmailHistoryStore(): EmailHistoryStore {
  const db = useDb()

  return {
    async record(accountEmail, address) {
      await db.insert(emailHistory).values({
        accountEmail,
        address,
        linkedAt: Date.now(),
      }).onConflictDoNothing()
    },

    async listAllForEmail(email) {
      const rows = await db
        .select()
        .from(emailHistory)
        .where(eq(emailHistory.accountEmail, email))
        .all()
      const addresses = rows.map(row => row.address)
      return addresses.includes(email) ? addresses : [email, ...addresses]
    },
  }
}
