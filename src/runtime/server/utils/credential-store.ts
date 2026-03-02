import type { CredentialStore, WebAuthnCredential } from '@openape/auth'
import { useIdpStorage } from './storage'

export function createCredentialStore(): CredentialStore {
  const storage = useIdpStorage()

  return {
    async save(credential) {
      await storage.setItem<WebAuthnCredential>(`credentials:${credential.credentialId}`, credential)

      const index = await storage.getItem<string[]>(`user-credentials:${credential.userEmail}`) || []
      if (!index.includes(credential.credentialId)) {
        index.push(credential.credentialId)
        await storage.setItem(`user-credentials:${credential.userEmail}`, index)
      }
    },

    async findById(credentialId) {
      return await storage.getItem<WebAuthnCredential>(`credentials:${credentialId}`) || null
    },

    async findByUser(email) {
      const index = await storage.getItem<string[]>(`user-credentials:${email}`) || []
      const credentials: WebAuthnCredential[] = []
      for (const id of index) {
        const cred = await storage.getItem<WebAuthnCredential>(`credentials:${id}`)
        if (cred)
          credentials.push(cred)
      }
      return credentials
    },

    async delete(credentialId) {
      const cred = await storage.getItem<WebAuthnCredential>(`credentials:${credentialId}`)
      if (cred) {
        const index = await storage.getItem<string[]>(`user-credentials:${cred.userEmail}`) || []
        const updated = index.filter(id => id !== credentialId)
        await storage.setItem(`user-credentials:${cred.userEmail}`, updated)
      }
      await storage.removeItem(`credentials:${credentialId}`)
    },

    async deleteAllForUser(email) {
      const index = await storage.getItem<string[]>(`user-credentials:${email}`) || []
      for (const id of index) {
        await storage.removeItem(`credentials:${id}`)
      }
      await storage.removeItem(`user-credentials:${email}`)
    },

    async updateCounter(credentialId, counter) {
      const cred = await storage.getItem<WebAuthnCredential>(`credentials:${credentialId}`)
      if (cred) {
        cred.counter = counter
        await storage.setItem(`credentials:${credentialId}`, cred)
      }
    },
  }
}
