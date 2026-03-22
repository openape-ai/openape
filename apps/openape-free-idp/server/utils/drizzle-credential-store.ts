import type { CredentialStore, WebAuthnCredential } from '@openape/auth'
import { eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { credentials } from '../database/schema'

type CredentialRow = typeof credentials.$inferSelect

function rowToCredential(row: CredentialRow): WebAuthnCredential {
  return {
    credentialId: row.credentialId,
    userEmail: row.userEmail,
    publicKey: row.publicKey,
    counter: row.counter,
    transports: (row.transports ?? undefined) as WebAuthnCredential['transports'],
    deviceType: row.deviceType as WebAuthnCredential['deviceType'],
    backedUp: row.backedUp,
    createdAt: row.createdAt,
    name: row.name ?? undefined,
  }
}

export function createDrizzleCredentialStore(): CredentialStore {
  const db = useDb()

  return {
    async save(credential) {
      await db.insert(credentials).values({
        credentialId: credential.credentialId,
        userEmail: credential.userEmail,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports as unknown as string[] | null ?? null,
        deviceType: credential.deviceType,
        backedUp: credential.backedUp,
        createdAt: credential.createdAt,
        name: credential.name ?? null,
      }).onConflictDoUpdate({
        target: credentials.credentialId,
        set: {
          counter: credential.counter,
          name: credential.name ?? null,
        },
      })
    },

    async findById(credentialId) {
      const row = await db.select().from(credentials).where(eq(credentials.credentialId, credentialId)).get()
      return row ? rowToCredential(row) : null
    },

    async findByUser(email) {
      const rows = await db.select().from(credentials).where(eq(credentials.userEmail, email))
      return rows.map(rowToCredential)
    },

    async delete(credentialId) {
      await db.delete(credentials).where(eq(credentials.credentialId, credentialId))
    },

    async deleteAllForUser(email) {
      await db.delete(credentials).where(eq(credentials.userEmail, email))
    },

    async updateCounter(credentialId, counter) {
      await db.update(credentials).set({ counter }).where(eq(credentials.credentialId, credentialId))
    },
  }
}
