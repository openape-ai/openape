import { defineEventHandler, setResponseHeader } from 'h3'
import { exportJWK } from 'jose'
import type { IdPStores } from '../config.js'

export function createJWKSHandler(stores: IdPStores) {
  return defineEventHandler(async (event) => {
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
}
