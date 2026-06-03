import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// SSRF guard for the agent `http.*` tools. The agent (LLM, potentially
// prompt-injected) chooses the URL, so a bare fetch lets it reach internal
// infrastructure: cloud metadata (169.254.169.254), RFC1918 services, loopback.
// We require http(s), DNS-resolve the host, and reject private/loopback/
// link-local/ULA/metadata targets — and re-validate on every redirect hop.
//
// NOTE: a near-identical guard exists in @openape/nuxt-auth-sp
// (ssrf-guard.ts). Consolidating both into a shared @openape/core util is a
// tracked follow-up; kept local here to preserve this package's node-only,
// dependency-free property.

/** True if `ip` is loopback, private, link-local, CGNAT, ULA, or unspecified. */
export function isBlockedAddress(ip: string): boolean {
  const fam = isIP(ip)
  if (fam === 4) {
    const o = ip.split('.')
    const a = Number(o[0])
    const b = Number(o[1])
    if (a === 0) return true // 0.0.0.0/8
    if (a === 127) return true // loopback
    if (a === 10) return true // 10/8
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
    if (a === 192 && b === 168) return true // 192.168/16
    if (a === 169 && b === 254) return true // link-local (incl. cloud metadata)
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
    return false
  }
  const low = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (low === '::' || low === '::1') return true
  if (low.startsWith('fe80')) return true // link-local
  if (low.startsWith('fc') || low.startsWith('fd')) return true // ULA fc00::/7
  const mapped = low.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) return isBlockedAddress(mapped[1]!)
  return false
}

/** Throw if `rawUrl` is not a safe, public http(s) target. */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(rawUrl)
  }
  catch {
    throw new Error(`Invalid URL: ${rawUrl}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`url must be http(s) (got ${url.protocol})`)
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
  if (addresses.length === 0) throw new Error(`Host did not resolve: ${host}`)
  for (const addr of addresses) {
    if (isBlockedAddress(addr)) {
      throw new Error(`Refusing to fetch a private/loopback address (${addr}) for ${rawUrl}`)
    }
  }
  return url
}

/**
 * fetch() with SSRF protection: validates the initial URL and re-validates
 * every redirect hop (redirects are followed manually, capped at maxRedirects).
 */
export async function safeFetch(rawUrl: string, init: RequestInit = {}, maxRedirects = 5): Promise<Response> {
  let current = rawUrl
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await assertPublicUrl(current)
    const res = await fetch(current, { ...init, redirect: 'manual' })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return res
      // Resolve relative redirects against the current URL, then re-validate.
      current = new URL(location, current).toString()
      // A redirect that turns a POST into a GET is standard; the body is not
      // re-sent by fetch on the next manual call, so drop it for safety.
      if (init.body) init = { ...init, body: undefined, method: 'GET' }
      continue
    }
    return res
  }
  throw new Error(`Too many redirects (>${maxRedirects}) for ${rawUrl}`)
}
