import type { KeyEntry, KeyStore } from '@openape/auth'
import type { JWK, KeyLike } from 'jose'
import { generateKeyPair } from '@openape/core'
import { eq } from 'drizzle-orm'
import { exportJWK, importJWK } from 'jose'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { signingKeys } from '../database/schema'
import type * as schema from '../database/schema'

export function createDrizzleKeyStore(db: LibSQLDatabase<typeof schema>): KeyStore {
  let cachedKeys: KeyEntry[] | null = null

  async function loadKeys(): Promise<KeyEntry[]> {
    if (cachedKeys) return cachedKeys

    const rows = await db.select().from(signingKeys).where(eq(signingKeys.isActive, true))
    const keys: KeyEntry[] = []

    for (const row of rows) {
      try {
        const privateKey = await importJWK(row.privateKeyJwk as JWK, 'EdDSA') as KeyLike
        const publicKey = await importJWK(row.publicKeyJwk as JWK, 'EdDSA') as KeyLike
        keys.push({ kid: row.kid, privateKey, publicKey })
      }
      catch {
        await db.update(signingKeys).set({ isActive: false }).where(eq(signingKeys.kid, row.kid))
      }
    }

    cachedKeys = keys
    return keys
  }

  async function createKey(): Promise<KeyEntry> {
    const { publicKey, privateKey } = await generateKeyPair()
    const kid = `key-${Date.now()}`

    const privateKeyJwk = await exportJWK(privateKey)
    const publicKeyJwk = await exportJWK(publicKey)

    await db.insert(signingKeys).values({
      kid,
      privateKeyJwk: privateKeyJwk as unknown as Record<string, unknown>,
      publicKeyJwk: publicKeyJwk as unknown as Record<string, unknown>,
      isActive: true,
      createdAt: Date.now(),
    })

    const entry: KeyEntry = { kid, privateKey, publicKey }
    cachedKeys = [entry]
    return entry
  }

  return {
    async getSigningKey() {
      const keys = await loadKeys()
      if (keys.length === 0) return createKey()
      return keys[0]!
    },

    async getAllPublicKeys() {
      return loadKeys()
    },
  }
}
