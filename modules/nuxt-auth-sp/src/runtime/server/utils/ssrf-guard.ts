import { assertPublicUrl } from '@openape/core'

// Thin wrapper around the authoritative SSRF guard in @openape/core.
// nuxt-auth-sp uses https-only mode (assertPublicUrl default) plus a
// dev-hatch that skips the check entirely for local IdP development.
//
// Dev hatch: set OPENAPE_SP_ALLOW_INSECURE_IDP=1 to allow http:// and
// private/loopback issuers (local IdP during development). Never set in prod.

export { isBlockedAddress } from '@openape/core'

const ALLOW_INSECURE = process.env.OPENAPE_SP_ALLOW_INSECURE_IDP === '1'

/**
 * Reject an IdP issuer URL that is not safe to fetch from the server:
 * non-https schemes and hosts resolving to private/loopback/link-local
 * addresses. Throws on rejection; resolves on success.
 *
 * Dev hatch: if OPENAPE_SP_ALLOW_INSECURE_IDP=1 the entire check is skipped
 * (allows http:// and private/loopback issuers for local development).
 *
 * Residual: a DNS-rebinding attacker could resolve to a public IP here and a
 * private one at fetch-connect time. `createRemoteJWKSet` is additionally given
 * a short timeout and redirects are refused (see cli-exchange.ts). Pinning the
 * validated IP for the actual connection is a future hardening step.
 */
export async function assertSafeIdpUrl(idpUrl: string): Promise<void> {
  if (ALLOW_INSECURE) return
  // assertPublicUrl defaults to https-only, which is exactly what the SP needs.
  await assertPublicUrl(idpUrl)
}
