import type { KeyEntry, KeyStore } from '@openape/auth'
import type { KeyLike } from 'jose'
import { generateKeyPair } from '@openape/core'
import { exportJWK, importJWK } from 'jose'
import { useAppStorage } from './storage'

interface StoredKey {
  kid: string
  privateKeyJwk: Record<string, unknown>
  publicKeyJwk: Record<string, unknown>
  isActive: boolean
}

export function createKeyStore(): KeyStore {
  const storage = useAppStorage()
  let cachedKeys: KeyEntry[] | null = null

  async function loadKeys(): Promise<KeyEntry[]> {
    if (cachedKeys)
      return cachedKeys

    const allKeys = await storage.getKeys('keys:')
    if (allKeys.length === 0)
      return []

    const keys: KeyEntry[] = []
    for (const key of allKeys) {
      const stored = await storage.getItem<StoredKey>(key)
      if (!stored || stored.isActive === false)
        continue

      const privateKey = await importJWK(stored.privateKeyJwk, 'ES256') as KeyLike
      const publicKey = await importJWK(stored.publicKeyJwk, 'ES256') as KeyLike

      keys.push({ kid: stored.kid, privateKey, publicKey })
    }

    cachedKeys = keys
    return keys
  }

  async function createKey(): Promise<KeyEntry> {
    const { publicKey, privateKey } = await generateKeyPair()
    const kid = `key-${Date.now()}`

    const privateKeyJwk = await exportJWK(privateKey)
    const publicKeyJwk = await exportJWK(publicKey)

    await storage.setItem<StoredKey>(`keys:${kid}`, {
      kid,
      privateKeyJwk,
      publicKeyJwk,
      isActive: true,
    })

    const entry: KeyEntry = { kid, privateKey, publicKey }
    cachedKeys = [entry]
    return entry
  }

  return {
    async getSigningKey() {
      const keys = await loadKeys()
      if (keys.length === 0)
        return createKey()
      return keys[0]
    },

    async getAllPublicKeys() {
      return loadKeys()
    },
  }
}
