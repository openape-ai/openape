import type { DDISARecord, PolicyMode } from '../types/index.js'

const VALID_MODES: PolicyMode[] = ['open', 'allowlist-admin', 'allowlist-user', 'deny']
const DDISA_VERSION = 'ddisa1'

/**
 * Parse a DDISA DNS TXT record string.
 * Format: "v=ddisa1 idp=https://idp.example.com; mode=open; priority=10"
 *
 * The version tag `v=ddisa1` must be present as the first token (space-delimited).
 * Remaining fields are semicolon-delimited key=value pairs.
 */
export function parseDDISARecord(txt: string): DDISARecord | null {
  const trimmed = txt.trim()

  // Version tag must be the first space-delimited token
  const spaceIdx = trimmed.indexOf(' ')
  if (spaceIdx === -1) return null

  const versionToken = trimmed.slice(0, spaceIdx).trim()
  if (versionToken !== `v=${DDISA_VERSION}`) return null

  const rest = trimmed.slice(spaceIdx + 1)
  const parts = rest.split(';').map(p => p.trim())
  const record: Partial<DDISARecord> = { raw: txt, version: DDISA_VERSION }

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
