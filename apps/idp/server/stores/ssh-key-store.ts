import type { SshKeyStore } from '@openape/auth'
import { eq } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { sshKeys } from '../database/schema'
import type * as schema from '../database/schema'

const CACHE_TTL = 30_000 // 30 seconds

interface SshKey {
  keyId: string
  userEmail: string
  publicKey: string
  name: string
  createdAt: number
}

function mapRow(row: typeof sshKeys.$inferSelect): SshKey {
  return {
    keyId: row.keyId,
    userEmail: row.userEmail,
    publicKey: row.publicKey,
    name: row.name,
    createdAt: row.createdAt,
  }
}

/**
 * Drizzle SSH key store with in-memory cache.
 * SSH key lookups are hot during auth flows (authenticate looks up keys by user email).
 * Cache TTL is 30s — SSH keys rarely change.
 */
export function createDrizzleSshKeyStore(db: LibSQLDatabase<typeof schema>): SshKeyStore {
  const byUserCache = new Map<string, { keys: SshKey[], cachedAt: number }>()

  function invalidateUser(email: string) {
    byUserCache.delete(email)
  }

  return {
    async save(key) {
      await db.insert(sshKeys).values({
        keyId: key.keyId,
        userEmail: key.userEmail,
        publicKey: key.publicKey,
        name: key.name,
        createdAt: key.createdAt,
      })
      invalidateUser(key.userEmail)
    },

    async findById(keyId) {
      const rows = await db.select().from(sshKeys).where(eq(sshKeys.keyId, keyId)).limit(1)
      return rows[0] ? mapRow(rows[0]) : null
    },

    async findByUser(email) {
      const cached = byUserCache.get(email)
      if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
        return cached.keys
      }

      const rows = await db.select().from(sshKeys).where(eq(sshKeys.userEmail, email))
      const keys = rows.map(mapRow)
      byUserCache.set(email, { keys, cachedAt: Date.now() })
      return keys
    },

    async findByPublicKey(publicKey) {
      const rows = await db.select().from(sshKeys).where(eq(sshKeys.publicKey, publicKey)).limit(1)
      return rows[0] ? mapRow(rows[0]) : null
    },

    async delete(keyId) {
      // Look up the key first to know which user cache to invalidate
      const rows = await db.select().from(sshKeys).where(eq(sshKeys.keyId, keyId)).limit(1)
      await db.delete(sshKeys).where(eq(sshKeys.keyId, keyId))
      if (rows[0]) invalidateUser(rows[0].userEmail)
    },

    async deleteAllForUser(email) {
      await db.delete(sshKeys).where(eq(sshKeys.userEmail, email))
      invalidateUser(email)
    },
  }
}
