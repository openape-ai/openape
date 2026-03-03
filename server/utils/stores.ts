import type { CodeEntry, CodeStore, KeyEntry, KeyStore } from '@openape/auth'
import type { JWK, KeyLike } from 'jose'
import { generateKeyPair } from '@openape/core'
import { exportJWK, importJWK } from 'jose'
import { eq } from 'drizzle-orm'
import { useRuntimeConfig } from '#imports'
import { useDb } from './db'
import { authCodes, signingKeys } from '../database/schema'

export function createCodeStore(): CodeStore {
  const db = useDb()

  return {
    async save(entry: CodeEntry) {
      await db.insert(authCodes).values({
        code: entry.code,
        spId: entry.spId,
        redirectUri: entry.redirectUri,
        codeChallenge: entry.codeChallenge,
        userId: entry.userId,
        nonce: entry.nonce,
        expiresAt: entry.expiresAt,
      })
    },

    async find(code: string) {
      const row = await db.select().from(authCodes).where(eq(authCodes.code, code)).get()
      if (!row) return null
      if (row.expiresAt < Date.now()) {
        await db.delete(authCodes).where(eq(authCodes.code, code))
        return null
      }
      return {
        code: row.code,
        spId: row.spId,
        redirectUri: row.redirectUri,
        codeChallenge: row.codeChallenge,
        userId: row.userId,
        nonce: row.nonce,
        expiresAt: row.expiresAt,
      }
    },

    async delete(code: string) {
      await db.delete(authCodes).where(eq(authCodes.code, code))
    },
  }
}

export function createKeyStore(): KeyStore {
  const db = useDb()
  let cachedKeys: KeyEntry[] | null = null

  async function loadKeys(): Promise<KeyEntry[]> {
    if (cachedKeys) return cachedKeys

    const rows = await db.select().from(signingKeys).where(eq(signingKeys.isActive, true)).all()
    if (rows.length === 0) return []

    const keys: KeyEntry[] = []
    for (const row of rows) {
      const privateKeyJwk = JSON.parse(row.privateKeyJwk) as JWK
      const publicKeyJwk = JSON.parse(row.publicKeyJwk) as JWK
      const privateKey = await importJWK(privateKeyJwk, 'ES256') as KeyLike
      const publicKey = await importJWK(publicKeyJwk, 'ES256') as KeyLike
      keys.push({ kid: row.kid, privateKey, publicKey })
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
      privateKeyJwk: JSON.stringify(privateKeyJwk),
      publicKeyJwk: JSON.stringify(publicKeyJwk),
      isActive: true,
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
      const keys = await loadKeys()
      if (keys.length === 0) {
        await createKey()
        return cachedKeys!
      }
      return keys
    },
  }
}

let _stores: { codeStore: CodeStore, keyStore: KeyStore } | null = null

export function useIdpStores() {
  if (!_stores) {
    _stores = {
      codeStore: createCodeStore(),
      keyStore: createKeyStore(),
    }
  }
  return _stores
}

export function getIdpIssuer(): string {
  const config = useRuntimeConfig()
  return (config.issuer || 'https://id.openape.at').trim()
}
