import { useIdpStorage } from './storage'

export interface SshKey {
  keyId: string
  userEmail: string
  publicKey: string
  name: string
  createdAt: number
}

export interface SshKeyStore {
  save: (key: SshKey) => Promise<void>
  findById: (keyId: string) => Promise<SshKey | null>
  findByUser: (email: string) => Promise<SshKey[]>
  findByPublicKey: (publicKey: string) => Promise<SshKey | null>
  delete: (keyId: string) => Promise<void>
  /** See @openape/auth SshKeyStore — `exceptKeyId` is the safety hatch for #295. */
  deleteAllForUser: (email: string, opts?: { exceptKeyId?: string }) => Promise<void>
}

export function createSshKeyStore(): SshKeyStore {
  const storage = useIdpStorage()

  return {
    async save(key) {
      await storage.setItem<SshKey>(`ssh-keys:${key.keyId}`, key)

      const index = await storage.getItem<string[]>(`user-ssh-keys:${key.userEmail}`) || []
      if (!index.includes(key.keyId)) {
        index.push(key.keyId)
        await storage.setItem(`user-ssh-keys:${key.userEmail}`, index)
      }
    },

    async findById(keyId) {
      return await storage.getItem<SshKey>(`ssh-keys:${keyId}`) || null
    },

    async findByUser(email) {
      const index = await storage.getItem<string[]>(`user-ssh-keys:${email}`) || []
      const keys: SshKey[] = []
      for (const id of index) {
        const key = await storage.getItem<SshKey>(`ssh-keys:${id}`)
        if (key) keys.push(key)
      }
      return keys
    },

    async findByPublicKey(publicKey) {
      // Linear scan — fine for typical key counts per IdP
      // Drizzle implementation in free-idp uses a DB index
      const allKeys = await storage.getKeys('ssh-keys:')
      for (const storageKey of allKeys) {
        const key = await storage.getItem<SshKey>(storageKey)
        if (key && key.publicKey === publicKey) return key
      }
      return null
    },

    async delete(keyId) {
      const key = await storage.getItem<SshKey>(`ssh-keys:${keyId}`)
      if (key) {
        const index = await storage.getItem<string[]>(`user-ssh-keys:${key.userEmail}`) || []
        const updated = index.filter(id => id !== keyId)
        await storage.setItem(`user-ssh-keys:${key.userEmail}`, updated)
      }
      await storage.removeItem(`ssh-keys:${keyId}`)
    },

    async deleteAllForUser(email, opts) {
      const except = opts?.exceptKeyId
      const index = await storage.getItem<string[]>(`user-ssh-keys:${email}`) || []
      const remaining: string[] = []
      for (const id of index) {
        if (id === except) {
          remaining.push(id)
          continue
        }
        await storage.removeItem(`ssh-keys:${id}`)
      }
      if (remaining.length > 0) {
        await storage.setItem(`user-ssh-keys:${email}`, remaining)
      }
      else {
        await storage.removeItem(`user-ssh-keys:${email}`)
      }
    },
  }
}
