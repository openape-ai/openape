import type { JtiStore } from '@openape/auth'
import { eq } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { jtis } from '../database/schema'
import type * as schema from '../database/schema'

export function createDrizzleJtiStore(db: LibSQLDatabase<typeof schema>): JtiStore {
  return {
    async hasBeenUsed(jti: string): Promise<boolean> {
      const row = await db.select().from(jtis).where(eq(jtis.jti, jti)).get()
      if (!row) return false
      if (row.expiresAt < Date.now()) {
        await db.delete(jtis).where(eq(jtis.jti, jti))
        return false
      }
      return true
    },

    async markUsed(jti: string, ttlMs: number): Promise<void> {
      await db.insert(jtis).values({
        jti,
        expiresAt: Date.now() + ttlMs,
      }).onConflictDoUpdate({
        target: jtis.jti,
        set: { expiresAt: Date.now() + ttlMs },
      })
    },
  }
}
