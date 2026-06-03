import { extractDomain, resolveIdP } from '@openape/core'

// DDISA trust doctrine (protocol sp-data-access.md §2.1): the authoritative
// issuer for a subject is whatever the SUBJECT'S domain points to via
// `_ddisa.<domain>`. The Provider MUST resolve it dynamically — no hardcoded
// issuer, no allowlist on this path. Fallback to id.openape.ai only when a
// domain publishes no DDISA record (behaviour-preserving for legacy
// single-IdP users; e.g. id.openape.ai's own domain resolves to itself).
const FALLBACK_ISSUER = 'https://id.openape.ai'

/**
 * Decode a JWT payload WITHOUT verifying the signature — used solely to read
 * `sub` so we can discover the authoritative issuer via the subject's domain.
 * The token is fully verified afterwards against THAT issuer's JWKS, so a
 * forged/altered token cannot benefit from this peek.
 */
export function unsafeDecodeSub(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf-8')) as { sub?: unknown }
    return typeof payload.sub === 'string' && payload.sub.includes('@') ? payload.sub : null
  }
  catch {
    return null
  }
}

export interface ResolvedIssuer {
  sub: string
  issuer: string
  jwksUri: string
}

/**
 * Resolve the issuer to verify a subject_token against, from the subject's
 * own domain via DDISA. Returns null if the token carries no usable email
 * subject.
 */
export async function resolveIssuerForToken(token: string): Promise<ResolvedIssuer | null> {
  const sub = unsafeDecodeSub(token)
  if (!sub) return null
  const domain = extractDomain(sub)
  const idp = (await resolveIdP(domain).catch(() => null)) || FALLBACK_ISSUER
  const issuer = idp.replace(/\/$/, '')
  return { sub, issuer, jwksUri: `${issuer}/.well-known/jwks.json` }
}

export { FALLBACK_ISSUER }
