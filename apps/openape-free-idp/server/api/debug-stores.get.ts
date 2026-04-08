import { defineEventHandler } from 'h3'
import { getStoreFactory } from '@openape/nuxt-auth-idp/runtime/server/utils/store-registry'

export default defineEventHandler(async (event) => {
  const results: Record<string, unknown> = {}

  // Check registry directly
  results.registryUserStore = getStoreFactory('userStore') ? 'registered' : 'NOT registered'
  results.registryCredentialStore = getStoreFactory('credentialStore') ? 'registered' : 'NOT registered'
  results.registrySshKeyStore = getStoreFactory('sshKeyStore') ? 'registered' : 'NOT registered'

  // Check stores
  const { userStore, credentialStore, sshKeyStore } = useIdpStores()

  try {
    const user = await userStore.findByEmail('patrick@hofmann.eco')
    results.userStore = user ? `found: ${user.email} (owner: ${user.owner ?? 'none'})` : 'not found'
  }
  catch (e: any) { results.userStore = `error: ${e.message}` }

  try {
    const creds = await credentialStore.findByUser('patrick@hofmann.eco')
    results.credentialStore = `found: ${creds.length} credentials`
  }
  catch (e: any) { results.credentialStore = `error: ${e.message}` }

  try {
    const keys = await sshKeyStore.findByUser('patrick@hofmann.eco')
    results.sshKeyStore = `found: ${keys.length} keys`
  }
  catch (e: any) { results.sshKeyStore = `error: ${e.message}` }

  return results
})
