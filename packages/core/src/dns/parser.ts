import type { DDISARecord, PolicyMode } from '../types/index.js'

const VALID_MODES: PolicyMode[] = ['open', 'allowlist-admin', 'allowlist-user', 'deny']
const DDISA_VERSION = 'ddisa1'

/**
 * Validate a DDISA `idp=` URL.
 *
 * The IdP URL is the trust anchor for the entire DDISA flow — every
 * SP that resolves it will fetch JWKS from there and accept the
 * resulting assertions. A poisoned DNS record can therefore redirect
 * every login through an attacker IdP. To make that harder we reject
 * URLs that don't pass these tests:
 *
 *   - parseable URL
 *   - protocol = `https:` (production); `http:` allowed only when
 *     `OPENAPE_DDISA_ALLOW_HTTP=1` is set in the env (dev shortcut)
 *   - hostname has no embedded credentials (`user:pass@`)
 *   - hostname has no IDN homograph confusables (must round-trip
 *     identically through `URL` parsing — defends against right-to-left
 *     override + homoglyph spoofs)
 *
 * No host allow-list — that's an SP-side concern (#280 / per-deploy
 * config). Here we just ensure the URL is structurally trustworthy.
 *
 * Returns `null` on rejection so the caller treats the record as
 * absent.
 */
function isValidIdpUrl(value: string): string | null {
  if (!value) return null

  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    return null
  }

  const allowHttp = process.env.OPENAPE_DDISA_ALLOW_HTTP === '1'
  const httpsOnly = url.protocol === 'https:'
  const httpAcceptable = allowHttp && url.protocol === 'http:'
  if (!httpsOnly && !httpAcceptable) return null

  // Reject embedded credentials — `https://attacker:x@idp.victim.com`
  // would let `idp.victim.com` host JWKS but the URL stamps the raw
  // string into auth.json on the SP side; if any consumer fetches
  // without sanitising, the credentials travel with it.
  if (url.username || url.password) return null

  // IDN homograph defence: reject the URL when the original input
  // string contains any non-ASCII character. URL parsing punycode-
  // converts hostnames so url.hostname is always ASCII; the check
  // has to happen against the raw input. A legitimate punycode label
  // (`xn--…`) is unaffected because it's pure ASCII to begin with.
  // Reject any non-printable-ASCII characters in the input. Anything
  // outside U+0020..U+007E (and a few whitespace controls) is a homograph
  // / RTL-override / null-byte injection vector.
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c !== 0x09 && (c < 0x20 || c > 0x7E)) return null
  }

  // Return the original input rather than `url.toString()` so we
  // don't normalise a trailing slash onto operator-specified records
  // — preserving exact byte-for-byte forwarding to SPs.
  return value
}

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
  if (spaceIdx === -1)
    return null

  const versionToken = trimmed.slice(0, spaceIdx).trim()
  if (versionToken !== `v=${DDISA_VERSION}`)
    return null

  const rest = trimmed.slice(spaceIdx + 1)
  const parts = rest.split(';').map(p => p.trim())
  const record: Partial<DDISARecord> = { raw: txt, version: DDISA_VERSION }

  for (const part of parts) {
    const eqIndex = part.indexOf('=')
    if (eqIndex === -1)
      continue

    const key = part.slice(0, eqIndex).trim().toLowerCase()
    const value = part.slice(eqIndex + 1).trim()

    switch (key) {
      case 'idp': {
        const validated = isValidIdpUrl(value)
        if (validated) record.idp = validated
        break
      }
      case 'mode':
        if (VALID_MODES.includes(value as PolicyMode)) {
          record.mode = value as PolicyMode
        }
        break
      case 'priority':
        record.priority = Number.parseInt(value, 10)
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
