import { exportJWK } from 'jose'

export default defineEventHandler(async (event) => {
  const stores = await getStores()

  // Override the default no-store with a cacheable policy for public keys
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')

  const entries = await stores.keyStore.getAllPublicKeys()
  const keys = await Promise.all(
    entries.map(async (entry) => {
      const jwk = await exportJWK(entry.publicKey)
      return { ...jwk, kid: entry.kid, alg: 'EdDSA', use: 'sig' }
    }),
  )
  return { keys }
})
