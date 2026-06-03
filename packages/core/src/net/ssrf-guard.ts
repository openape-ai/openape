import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// Authoritative SSRF guard for all OpenApe packages. Blocks private/loopback/
// link-local/CGNAT/ULA/unspecified addresses so that attacker-controlled URLs
// (from DNS TXT records, LLM tool-calls, etc.) cannot reach internal
// infrastructure: cloud metadata (169.254.169.254), RFC1918 services, loopback.
//
// Consumers:
//   nuxt-auth-sp  — assertSafeIdpUrl() wraps assertPublicUrl() (https-only)
//   agent-runtime — assertPublicUrl(url, { allowHttp: true }) + safeFetch()

/** True if `ip` is loopback, private (RFC1918), link-local, CGNAT, ULA, or unspecified. */
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
  if (low.startsWith('fc') || low.startsWith('fd')) return true // unique-local (ULA) fc00::/7
  const mapped = low.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) return isBlockedAddress(mapped[1]!)
  return false
}

export interface AssertPublicUrlOptions {
  /**
   * When true, http:// is accepted in addition to https://.
   * Default: false (https-only).
   */
  allowHttp?: boolean
}

/**
 * Throws if `rawUrl` is not a safe, public target:
 * - Must parse as a valid URL.
 * - Scheme must be https (or http when `allowHttp` is true).
 * - Hostname must DNS-resolve and none of the resolved addresses may be
 *   loopback, private, link-local, CGNAT, ULA, or unspecified.
 *
 * Returns the parsed URL on success.
 */
export async function assertPublicUrl(rawUrl: string, opts: AssertPublicUrlOptions = {}): Promise<URL> {
  let url: URL
  try {
    url = new URL(rawUrl)
  }
  catch {
    throw new Error(`Invalid URL: ${rawUrl}`)
  }

  const allowedSchemes = opts.allowHttp === true
    ? new Set(['https:', 'http:'])
    : new Set(['https:'])

  if (!allowedSchemes.has(url.protocol)) {
    const expected = opts.allowHttp === true ? 'http(s)' : 'https'
    throw new Error(`URL must use ${expected}:// (got ${url.protocol}//) — ${rawUrl}`)
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
    throw new Error(`Host did not resolve: ${host}`)
  }

  for (const addr of addresses) {
    if (isBlockedAddress(addr)) {
      throw new Error(`Refusing to fetch a private/loopback address (${addr}) for ${rawUrl}`)
    }
  }

  return url
}
