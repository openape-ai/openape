import type { ConsentEntry, ConsentStore } from '@openape/auth'
import { useIdpStorage } from './storage'

/**
 * Persistent ConsentStore backed by `unstorage`.
 *
 * Records that a given user has approved a given SP for the
 * `allowlist-user` policy mode (DDISA core.md §2.3). Once consent
 * is on file the user no longer sees the consent screen for that SP.
 *
 * The free-idp deployment can swap this for a Drizzle-backed store
 * via the store-registry (see `define-stores.ts`); the in-memory
 * fallback in `@openape/auth` covers tests + dev playground.
 */
export function createConsentStore(): ConsentStore {
  const storage = useIdpStorage()

  function key(userId: string, clientId: string): string {
    // Lower-case both halves so casing inconsistencies between IdP-emitted
    // emails and SP-supplied client_ids don't end up creating duplicate
    // rows. clientId is conventionally a hostname so case-insensitive
    // matches the public DNS reality.
    return `consents:${userId.toLowerCase()}:${clientId.toLowerCase()}`
  }

  function userPrefix(userId: string): string {
    return `consents:${userId.toLowerCase()}:`
  }

  return {
    async hasConsent(userId: string, clientId: string): Promise<boolean> {
      return await storage.hasItem(key(userId, clientId))
    },

    async save(entry: ConsentEntry): Promise<void> {
      await storage.setItem<ConsentEntry>(
        key(entry.userId, entry.clientId),
        entry,
      )
    },

    async list(userId: string): Promise<ConsentEntry[]> {
      // Linear scan over the user's namespace. Fine for any realistic
      // user — even a power-user with hundreds of approved SPs is well
      // under the limit unstorage is comfortable with. Sorting happens
      // client-side because the storage isn't ordered.
      const keys = await storage.getKeys(userPrefix(userId))
      const entries: ConsentEntry[] = []
      for (const k of keys) {
        const v = await storage.getItem<ConsentEntry>(k)
        if (v) entries.push(v)
      }
      entries.sort((a, b) => b.grantedAt - a.grantedAt)
      return entries
    },

    async revoke(userId: string, clientId: string): Promise<void> {
      await storage.removeItem(key(userId, clientId))
    },
  }
}
