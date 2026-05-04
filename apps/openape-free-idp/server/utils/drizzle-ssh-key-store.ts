// SshKeyStore type is auto-imported from @openape/nuxt-auth-idp via addServerImportsDir
import { and, eq, ne } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { sshKeys } from '../database/schema'

export function createDrizzleSshKeyStore(): SshKeyStore {
  const db = useDb()

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

    async deleteAllForUser(email, opts) {
      const except = opts?.exceptKeyId
      const filter = except
        ? and(eq(sshKeys.userEmail, email), ne(sshKeys.keyId, except))
        : eq(sshKeys.userEmail, email)
      await db.delete(sshKeys).where(filter)
    },
  }
}

function mapRow(row: typeof sshKeys.$inferSelect) {
  return {
    keyId: row.keyId,
    userEmail: row.userEmail,
    publicKey: row.publicKey,
    name: row.name,
    createdAt: row.createdAt,
  }
}
