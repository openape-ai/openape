import type { NitroApp } from 'nitropack'
import { useRuntimeConfig } from 'nitropack/runtime'
import { useIdpStores } from '../utils/stores'

const DEFAULT_SESSION_SECRET = 'change-me-to-a-real-secret-at-least-32-chars'

export default async (_nitroApp: NitroApp) => {
  // Refuse to boot with the literal default sessionSecret (#283 item 1).
  // The default is public source — leaving it in place lets anyone reading
  // the repo forge any session cookie. Test runs skip the check.
  if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
    const config = useRuntimeConfig() as { openapeIdp?: { sessionSecret?: string } }
    const secret = config.openapeIdp?.sessionSecret ?? ''
    if (!secret || secret === DEFAULT_SESSION_SECRET) {
      throw new Error(
        '[openape-idp] NUXT_OPENAPE_SESSION_SECRET is unset or still the public default. '
        + 'Set a unique secret (>= 32 chars) before deploying — session cookies are forgeable otherwise.',
      )
    }
  }

  // Ensure a signing key exists on startup so JWKS is never empty
  try {
    const { keyStore } = useIdpStores()
    await keyStore.getSigningKey()
  }
  catch (err) {
    console.warn('[openape-idp] Failed to initialize signing key on startup:', err)
  }
}
