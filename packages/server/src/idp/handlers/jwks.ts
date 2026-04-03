import { defineEventHandler } from 'h3'
import { exportJWK } from 'jose'
import type { IdPStores } from '../config.js'

export function createJWKSHandler(stores: IdPStores) {
  return defineEventHandler(async () => {
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
