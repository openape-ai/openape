import type { DDISARecord, PolicyMode } from '../types/index.js'

const VALID_MODES: PolicyMode[] = ['open', 'allowlist-admin', 'allowlist-user', 'deny']

/**
 * Parse a DDISA DNS TXT record string.
 * Format: "idp=https://idp.example.com; mode=open; priority=10"
 */
export function parseDDISARecord(txt: string): DDISARecord | null {
  const parts = txt.split(';').map(p => p.trim())
  const record: Partial<DDISARecord> = { raw: txt }

  for (const part of parts) {
    const eqIndex = part.indexOf('=')
    if (eqIndex === -1) continue

    const key = part.slice(0, eqIndex).trim().toLowerCase()
    const value = part.slice(eqIndex + 1).trim()

    switch (key) {
      case 'idp':
        record.idp = value
        break
      case 'mode':
        if (VALID_MODES.includes(value as PolicyMode)) {
          record.mode = value as PolicyMode
        }
        break
      case 'priority':
        record.priority = parseInt(value, 10)
        break
      case 'policy_endpoint':
      case 'policy':
        record.policy_endpoint = value
        break
    }
  }

  if (!record.idp) {
    return null
  }

  return record as DDISARecord
}

/**
 * Extract domain from an email address.
 */
export function extractDomain(email: string): string {
  const parts = email.split('@')
  if (parts.length !== 2 || !parts[1]) {
    throw new Error(`Invalid email address: ${email}`)
  }
  return parts[1]
}
