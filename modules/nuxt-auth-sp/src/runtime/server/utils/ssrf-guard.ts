import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// SSRF guard for the dynamically-resolved DDISA issuer. The issuer URL comes
// from the SUBJECT's `_ddisa.<domain>` TXT record (attacker-influenceable), and
// we fetch its JWKS to verify the subject_token. Without a guard, a hostile
// domain could point its DDISA record at internal infrastructure (cloud
// metadata 169.254.169.254, RFC1918 services, loopback) and turn the verify
// step into a server-side request forgery.
//
// Dev hatch: set OPENAPE_SP_ALLOW_INSECURE_IDP=1 to allow http:// and
// private/loopback issuers (local IdP during development). Never set in prod.

const ALLOW_INSECURE = process.env.OPENAPE_SP_ALLOW_INSECURE_IDP === '1'

/** True if `ip` is loopback, private (RFC1918), link-local, CGNAT, or unspecified. */
export function isBlockedAddress(ip: string): boolean {
  const fam = isIP(ip)
  if (fam === 4) {
    const o = ip.split('.')
    const a = Number(o[0])
    const b = Number(o[1])
    if (a === 0) return true // 0.0.0.0/8 "this network"
    if (a === 127) return true // loopback
    if (a === 10) return true // 10/8
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
    if (a === 192 && b === 168) return true // 192.168/16
    if (a === 169 && b === 254) return true // link-local (incl. cloud metadata)
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
    return false
  }
  const low = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (low === '::' || low === '::1') return true // unspecified / loopback
  if (low.startsWith('fe80')) return true // link-local
  if (low.startsWith('fc') || low.startsWith('fd')) return true // unique-local fc00::/7
  const mapped = low.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) return isBlockedAddress(mapped[1]!)
  return false
}

/**
 * Reject an IdP issuer URL that is not safe to fetch from the server:
 * non-https schemes and hosts resolving to private/loopback/link-local
 * addresses. Throws on rejection; resolves on success.
 *
 * Residual: a DNS-rebinding attacker could resolve to a public IP here and a
 * private one at fetch-connect time. `createRemoteJWKSet` is additionally given
 * a short timeout and redirects are refused (see cli-exchange.ts). Pinning the
 * validated IP for the actual connection is a future hardening step.
 */
export async function assertSafeIdpUrl(idpUrl: string): Promise<void> {
  if (ALLOW_INSECURE) return

  let url: URL
  try {
    url = new URL(idpUrl)
  }
  catch {
    throw new Error(`Invalid IdP issuer URL: ${idpUrl}`)
  }

  if (url.protocol !== 'https:') {
    throw new Error(`IdP issuer must use https:// (got ${url.protocol}//) — ${idpUrl}`)
  }

  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses: string[] = []
  if (isIP(host)) {
    addresses.push(host)
  }
  else {
    const results = await lookup(host, { all: true })
    for (const r of results) addresses.push(r.address)
  }

  if (addresses.length === 0) {
    throw new Error(`IdP issuer host did not resolve: ${host}`)
  }
  for (const addr of addresses) {
    if (isBlockedAddress(addr)) {
      throw new Error(`IdP issuer host resolves to a blocked address (${addr}); refusing to fetch ${idpUrl}`)
    }
  }
}
