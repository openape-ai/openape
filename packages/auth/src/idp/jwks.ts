import type { JWK } from 'jose'
import type { KeyStore } from './stores.js'
import { exportPublicKeyJWK } from '@openape/core'

export interface JWKSResponse {
  keys: JWK[]
}

/**
 * Generate a JWKS response from the key store.
 */
export async function generateJWKS(keyStore: KeyStore): Promise<JWKSResponse> {
  const entries = await keyStore.getAllPublicKeys()
  const keys = await Promise.all(
    entries.map(entry => exportPublicKeyJWK(entry.publicKey, entry.kid)),
  )
  return { keys }
}

/**
 * Serve JWKS as a Response object.
 */
export async function serveJWKS(keyStore: KeyStore): Promise<Response> {
  const jwks = await generateJWKS(keyStore)
  return new Response(JSON.stringify(jwks), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
