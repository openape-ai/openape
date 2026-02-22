import { exportJWK } from 'jose'

export default defineEventHandler(async () => {
  const { keyStore } = useStores()
  const entries = await keyStore.getAllPublicKeys()
  const keys = await Promise.all(
    entries.map(async (entry) => {
      const jwk = await exportJWK(entry.publicKey)
      return { ...jwk, kid: entry.kid, alg: 'ES256', use: 'sig' }
    }),
  )
  return { keys }
})
