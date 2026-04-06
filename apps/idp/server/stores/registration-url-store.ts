import type { RegistrationUrl, RegistrationUrlStore } from '@openape/auth'
import { eq } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { registrationUrls } from '../database/schema'
import type * as schema from '../database/schema'

type RegistrationUrlRow = typeof registrationUrls.$inferSelect

function rowToRegistrationUrl(row: RegistrationUrlRow): RegistrationUrl {
  return {
    token: row.token,
    email: row.email,
    name: row.name,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    createdBy: row.createdBy,
    consumed: row.consumed,
  }
}

export function createDrizzleRegistrationUrlStore(db: LibSQLDatabase<typeof schema>): RegistrationUrlStore {
  return {
    async save(reg) {
      await db.insert(registrationUrls).values({
        token: reg.token,
        email: reg.email,
        name: reg.name,
        createdAt: reg.createdAt,
        expiresAt: reg.expiresAt,
        createdBy: reg.createdBy,
        consumed: reg.consumed,
      }).onConflictDoUpdate({
        target: registrationUrls.token,
        set: {
          email: reg.email,
          name: reg.name,
          expiresAt: reg.expiresAt,
          consumed: reg.consumed,
        },
      })
    },

    async find(token) {
      const row = await db.select().from(registrationUrls).where(eq(registrationUrls.token, token)).get()
      if (!row) return null
      if (row.expiresAt < Date.now() || row.consumed) return null
      return rowToRegistrationUrl(row)
    },

    async consume(token) {
      const row = await db.select().from(registrationUrls).where(eq(registrationUrls.token, token)).get()
      if (!row) return null
      if (row.expiresAt < Date.now() || row.consumed) return null
      await db.update(registrationUrls).set({ consumed: true }).where(eq(registrationUrls.token, token))
      return rowToRegistrationUrl({ ...row, consumed: true })
    },

    async list() {
      const rows = await db.select().from(registrationUrls)
      return rows.map(rowToRegistrationUrl)
    },

    async delete(token) {
      await db.delete(registrationUrls).where(eq(registrationUrls.token, token))
    },
  }
}
