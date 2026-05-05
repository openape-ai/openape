import { createHash, randomBytes } from 'node:crypto'
import { resolveTxt } from 'node:dns/promises'
import { and, eq, isNull } from 'drizzle-orm'
import type { useDb } from '../database/drizzle'
import { adminClaimSecrets, operators } from '../database/schema'

type Db = ReturnType<typeof useDb>

/**
 * DNS-rooted admin proof for the free-idp.
 *
 * The user mints a random claim secret; cleartext is shown ONCE in
 * the UI and otherwise never leaves the server. The hash is stored
 * in `admin_claim_secrets`. To prove admin status for a domain they
 * own, the user publishes the cleartext as a TXT record at
 * `_openape-admin-{idp-slug}.{their-email-domain}`. On verification
 * we read every TXT value at that name, hash each, and check whether
 * any matches the user's stored hash.
 *
 * Properties of this design:
 *   - Random secret: not reversible to email even with a wordlist.
 *   - DB stores only hashes: a DB compromise can't be turned into a
 *     DNS-claim attack.
 *   - Subdomain encodes the IdP: a domain that trusts multiple IdPs
 *     keeps separate per-IdP admin claims without conflict.
 *   - Domain control = identity authority, consistent with DDISA.
 */

/** "id.openape.ai" → "id-openape-ai", suitable for use as a DNS label. */
export function idpSlugFromIssuer(issuer: string): string {
  let host = issuer
  try { host = new URL(issuer).host }
  catch { /* fall back to the raw string */ }
  // Ports + IPs are unusual for production IdPs; if they appear we
  // sanitize to dashes too rather than producing an invalid label.
  return host.toLowerCase().replace(/[^a-z0-9-]/g, '-')
}

export function adminTxtName(idpIssuer: string, domain: string): string {
  return `_openape-admin-${idpSlugFromIssuer(idpIssuer)}.${domain}`
}

/** Lowercase hex SHA-256. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

/**
 * Mint a fresh 32-byte (= 256 bit) URL-safe secret. base64url over 32
 * bytes is 43 chars — short enough to hand-copy into a DNS UI without
 * crossing the 255-char TXT-string limit even with prefixes.
 */
export function generateClaimSecret(): string {
  return randomBytes(32).toString('base64url')
}

export function extractEmailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 0) return ''
  return email.slice(at + 1).toLowerCase()
}

/**
 * Resolve the TXT records at the admin claim name. Returns the raw
 * string values (one per record). Treats NXDOMAIN / no-data as empty
 * rather than throwing — that's the common case for a domain that
 * hasn't published a claim yet.
 */
async function resolveAdminTxt(name: string): Promise<string[]> {
  try {
    const records = await resolveTxt(name)
    // Each record is an array of strings (DNS allows multi-string
    // values); join them in the unlikely case a claim got split.
    return records.map(parts => parts.join(''))
  }
  catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'SERVFAIL') return []
    throw err
  }
}

interface CacheEntry {
  isRoot: boolean
  expires: number
}

const cache = new Map<string, CacheEntry>()
const POSITIVE_TTL_MS = 60_000
const NEGATIVE_TTL_MS = 30_000

function cacheKey(email: string, domain: string): string {
  return `${email.toLowerCase()}|${domain.toLowerCase()}`
}

export function clearAdminCache(email?: string, domain?: string): void {
  if (!email) {
    cache.clear()
    return
  }
  if (domain) {
    cache.delete(cacheKey(email, domain))
    return
  }
  // Clear all entries for this email across domains.
  const prefix = `${email.toLowerCase()}|`
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k)
  }
}

/**
 * Is this user a DNS-rooted root admin for their email's domain?
 * Resolves the admin TXT, hashes each value, looks up the user's
 * non-revoked secret hashes — match means root.
 *
 * Caches the answer per (user, domain) for POSITIVE_TTL_MS / NEGATIVE_TTL_MS
 * so the DNS lookup doesn't fire on every admin request. Demotion
 * happens at most NEGATIVE_TTL_MS after the user revokes — which is
 * fine because we also bust this cache explicitly on regenerate.
 */
export async function isRootAdmin(
  db: Db,
  idpIssuer: string,
  userEmail: string,
): Promise<boolean> {
  const domain = extractEmailDomain(userEmail)
  if (!domain) return false

  const key = cacheKey(userEmail, domain)
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.isRoot

  const secrets = await db
    .select({ secretHash: adminClaimSecrets.secretHash })
    .from(adminClaimSecrets)
    .where(and(
      eq(adminClaimSecrets.userEmail, userEmail.toLowerCase()),
      isNull(adminClaimSecrets.revokedAt),
    ))
    .all()
  if (secrets.length === 0) {
    cache.set(key, { isRoot: false, expires: Date.now() + NEGATIVE_TTL_MS })
    return false
  }

  const txtName = adminTxtName(idpIssuer, domain)
  const txtValues = await resolveAdminTxt(txtName)
  if (txtValues.length === 0) {
    cache.set(key, { isRoot: false, expires: Date.now() + NEGATIVE_TTL_MS })
    return false
  }

  const userHashes = new Set(secrets.map(s => s.secretHash))
  const isRoot = txtValues.some(v => userHashes.has(hashSecret(v)))
  cache.set(key, {
    isRoot,
    expires: Date.now() + (isRoot ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  })
  return isRoot
}

/**
 * Is this user an operator for their email's domain? Operators are
 * DB-rows promoted by a root admin — they get admin-tier power but
 * NOT root-tier (so they can't promote other operators).
 */
export async function isOperator(
  db: Db,
  userEmail: string,
): Promise<boolean> {
  const domain = extractEmailDomain(userEmail)
  if (!domain) return false
  const row = await db
    .select({ userEmail: operators.userEmail })
    .from(operators)
    .where(and(
      eq(operators.userEmail, userEmail.toLowerCase()),
      eq(operators.domain, domain),
    ))
    .get()
  return !!row
}
