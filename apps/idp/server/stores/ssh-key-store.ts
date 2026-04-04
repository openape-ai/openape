import type { SshKeyStore } from '@openape/auth'
import { eq } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { sshKeys } from '../database/schema'
import type * as schema from '../database/schema'

function mapRow(row: typeof sshKeys.$inferSelect) {
  return {
    keyId: row.keyId,
    userEmail: row.userEmail,
    publicKey: row.publicKey,
    name: row.name,
    createdAt: row.createdAt,
  }
}

export function createDrizzleSshKeyStore(db: LibSQLDatabase<typeof schema>): SshKeyStore {
  return {
    async save(key) {
      await db.insert(sshKeys).values({
        keyId: key.keyId,
        userEmail: key.userEmail,
        publicKey: key.publicKey,
        name: key.name,
        createdAt: key.createdAt,
      })
    },

    async findById(keyId) {
      const rows = await db.select().from(sshKeys).where(eq(sshKeys.keyId, keyId)).limit(1)
      return rows[0] ? mapRow(rows[0]) : null
    },

    async findByUser(email) {
      const rows = await db.select().from(sshKeys).where(eq(sshKeys.userEmail, email))
      return rows.map(mapRow)
    },

    async findByPublicKey(publicKey) {
      const rows = await db.select().from(sshKeys).where(eq(sshKeys.publicKey, publicKey)).limit(1)
      return rows[0] ? mapRow(rows[0]) : null
    },

    async delete(keyId) {
      await db.delete(sshKeys).where(eq(sshKeys.keyId, keyId))
    },

    async deleteAllForUser(email) {
      await db.delete(sshKeys).where(eq(sshKeys.userEmail, email))
    },
  }
}
