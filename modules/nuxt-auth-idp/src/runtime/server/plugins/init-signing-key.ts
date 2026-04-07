import type { NitroApp } from 'nitropack'
import { useIdpStores } from '../utils/stores'

export default async (_nitroApp: NitroApp) => {
  // Ensure a signing key exists on startup so JWKS is never empty
  try {
    const { keyStore } = useIdpStores()
    await keyStore.getSigningKey()
  }
  catch (err) {
    console.warn('[openape-idp] Failed to initialize signing key on startup:', err)
  }
}
