import { resolve4, resolve6 } from 'node:dns/promises'
import { isIP } from 'node:net'

const PRIVATE_RANGES_V4 = [
  { prefix: 0x7F000000, mask: 0xFF000000 }, // 127.0.0.0/8
  { prefix: 0x0A000000, mask: 0xFF000000 }, // 10.0.0.0/8
  { prefix: 0xAC100000, mask: 0xFFF00000 }, // 172.16.0.0/12
  { prefix: 0xC0A80000, mask: 0xFFFF0000 }, // 192.168.0.0/16
  { prefix: 0xA9FE0000, mask: 0xFFFF0000 }, // 169.254.0.0/16
  { prefix: 0x00000000, mask: 0xFF000000 }, // 0.0.0.0/8
]

function ipv4ToNumber(ip: string): number {
  const parts = ip.split('.').map(Number)
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

function isPrivateIPv4(ip: string): boolean {
  const num = ipv4ToNumber(ip)
  return PRIVATE_RANGES_V4.some(r => ((num & r.mask) >>> 0) === r.prefix)
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase()

  // Loopback ::1
  if (normalized === '::1') return true

  // Unspecified ::
  if (normalized === '::') return true

  // Link-local fe80::/10
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9')
    || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true
  }

  // Unique local fd00::/8
  if (normalized.startsWith('fd')) return true

  // IPv4-mapped ::ffff:x.x.x.x
  const v4mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (v4mapped) return isPrivateIPv4(v4mapped[1])

  return false
}

function isPrivateIP(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIPv4(ip)
  if (isIP(ip) === 6) return isPrivateIPv6(ip)
  return false
}

/**
 * Result of resolving a hostname for egress safety.
 *
 * - `ok` — resolved to at least one address, none of them private/loopback.
 *   Caller forwards.
 * - `private` — at least one resolved address is private/loopback. Caller
 *   refuses with a policy response (403).
 * - `unresolvable` — DNS returned NXDOMAIN, NODATA, or a query error. Caller
 *   responds with an upstream-failure code (502). Distinct from `private`
 *   because the host doesn't exist (or can't be reached) — that's not a
 *   policy decision, it's a connectivity problem, and conflating the two
 *   ships misleading 403s for typos and DNS hiccups.
 */
export type EgressCheckResult =
  | { kind: 'ok' }
  | { kind: 'private' }
  | { kind: 'unresolvable', reason: 'no-records' | 'dns-error' }

/**
 * Check whether forwarding a connection to `hostname` is safe.
 *
 * IP literals are checked directly; hostnames are resolved via DNS (A and
 * AAAA in parallel) and every returned address is screened against the
 * private-range list. If any address is private the result is `private`.
 *
 * Note on DNS-rebinding: a careful attacker could return a public IP to our
 * pre-flight resolution and a private one to the kernel's `connect()`. The
 * proper fix for that is pinning the resolved IP across the actual socket
 * call, not blocking on uncertainty — so we no longer conflate "I couldn't
 * resolve" with "this is private". Callers can layer pinning on top.
 */
export async function checkEgress(hostname: string): Promise<EgressCheckResult> {
  if (isIP(hostname)) {
    return isPrivateIP(hostname) ? { kind: 'private' } : { kind: 'ok' }
  }

  if (hostname === 'localhost') return { kind: 'private' }

  let settled: PromiseSettledResult<string[]>[]
  try {
    settled = await Promise.allSettled([resolve4(hostname), resolve6(hostname)])
  }
  catch {
    return { kind: 'unresolvable', reason: 'dns-error' }
  }

  const addrs: string[] = []
  for (const r of settled) {
    if (r.status === 'fulfilled') addrs.push(...r.value)
  }

  if (addrs.length === 0) {
    return { kind: 'unresolvable', reason: 'no-records' }
  }

  return addrs.some(addr => isPrivateIP(addr)) ? { kind: 'private' } : { kind: 'ok' }
}

/**
 * Backwards-compatible boolean shim. Returns true for both `private` and
 * `unresolvable` because that matches the previous (overly conservative)
 * behaviour. New code should call `checkEgress` and distinguish.
 *
 * @deprecated Use `checkEgress` so the caller can return 502 for unresolvable
 * hosts and 403 only for actual private/loopback IPs.
 */
export async function isPrivateOrLoopback(hostname: string): Promise<boolean> {
  const result = await checkEgress(hostname)
  return result.kind !== 'ok'
}
