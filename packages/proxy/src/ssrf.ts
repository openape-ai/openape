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
 * Check if a hostname resolves to a private or loopback IP.
 * If the hostname is already an IP literal, check directly.
 * Otherwise, resolve via DNS and check all results.
 */
export async function isPrivateOrLoopback(hostname: string): Promise<boolean> {
  // Direct IP literal
  if (isIP(hostname)) {
    return isPrivateIP(hostname)
  }

  // localhost shortcut
  if (hostname === 'localhost') return true

  // DNS resolution — check both A and AAAA records
  try {
    const [v4, v6] = await Promise.allSettled([
      resolve4(hostname),
      resolve6(hostname),
    ])
    const addrs: string[] = []
    if (v4.status === 'fulfilled') addrs.push(...v4.value)
    if (v6.status === 'fulfilled') addrs.push(...v6.value)

    if (addrs.length === 0) return true // no records — block to be safe
    return addrs.some(addr => isPrivateIP(addr))
  }
  catch {
    // DNS failure — block to be safe
    return true
  }
}
