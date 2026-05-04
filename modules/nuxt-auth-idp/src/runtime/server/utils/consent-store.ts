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
  }
}
