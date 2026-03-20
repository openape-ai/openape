/**
 * Parse a human-readable duration string into seconds.
 * Supported formats: 30s, 5m, 1h, 7d
 */
export function parseDuration(value: string): number {
  const match = value.match(/^(\d+)\s*([smhd])$/)
  if (!match) {
    throw new Error(`Invalid duration format: "${value}". Use e.g. 30m, 1h, 7d`)
  }
  const amount = Number.parseInt(match[1]!, 10)
  switch (match[2]) {
    case 's': return amount
    case 'm': return amount * 60
    case 'h': return amount * 3600
    case 'd': return amount * 86400
    default: throw new Error(`Unknown duration unit: ${match[2]}`)
  }
}
