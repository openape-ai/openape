import type { JtiStore } from '@openape/auth'
import { eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { jtis } from '../database/schema'

export function createDrizzleJtiStore(): JtiStore {
  const db = useDb()

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
