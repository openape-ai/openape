import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
  const { userStore, credentialStore, sshKeyStore } = useIdpStores()
  
  const results: Record<string, unknown> = {}
  
  try {
    const user = await userStore.findByEmail('patrick@hofmann.eco')
    results.userStore = user ? `found: ${user.email}` : 'not found'
  } catch (e: any) { results.userStore = `error: ${e.message}` }
  
  try {
    const creds = await credentialStore.findByUser('patrick@hofmann.eco')
    results.credentialStore = `found: ${creds.length} credentials`
  } catch (e: any) { results.credentialStore = `error: ${e.message}` }
  
  try {
    const keys = await sshKeyStore.findByUser('patrick@hofmann.eco')
    results.sshKeyStore = `found: ${keys.length} keys`
  } catch (e: any) { results.sshKeyStore = `error: ${e.message}` }
  
  return results
})
