import { jwtVerify, SignJWT } from 'jose'

// Pattern copied from openape-chat. troop's CLI-scoped SP token is an
// HS256 JWT minted by /api/cli/exchange after the IdP-issued
// subject_token has been verified via JWKS. Clients (org.openape.ai's
// spawn-proxy + future delegates) cache it for the duration of its TTL
// and present it as `Authorization: Bearer …` on troop's gated routes.
const ISSUER = 'troop.openape.ai'
const AUDIENCE = 'troop.openape.ai'

export interface CliTokenPayload {
  iss: 'troop.openape.ai'
  aud: 'troop.openape.ai'
  typ: 'cli'
  sub: string
  email: string
  act: 'human' | 'agent'
  /**
   * Scopes the holder is allowed to exercise on troop. Empty array =
   *  no scope restriction (first-party `apes login` from a human),
   *  treated as "all routes the sub already had access to" — matches
   *  the openape-chat behaviour-preserving rule (sp-data-access §5.3).
   *  Non-empty = delegated access, route handlers MUST check.
   */
  scope: string[]
  /**
   * Provenance audit — the delegate domain string from the subject
   *  token's claims (sp-data-access §5.3). null for first-party.
   */
  delegate: string | null
  iat: number
  exp: number
}

function secret(): Uint8Array {
  const s = (useRuntimeConfig().openapeSp?.sessionSecret as string) || ''
  if (!s || s.length < 32) {
    throw createError({ statusCode: 500, statusMessage: 'CLI token secret not configured (openapeSp.sessionSecret < 32 chars)' })
  }
  return new TextEncoder().encode(s)
}

/**
 * Mint an HS256 troop-scoped CLI token. Spec recommends ≤15 min for
 * delegated tokens (sp-data-access §6); first-party (no delegate, no
 * scope) gets the same 30-day TTL as openape-chat for CLI continuity.
 */
export async function signCliToken(params: {
  email: string
  act: 'human' | 'agent'
  scope?: string[]
  delegate?: string | null
  ttlSeconds?: number
}): Promise<{ token: string, expiresAt: number }> {
  const isDelegated = Boolean(params.scope?.length || params.delegate)
  const ttl = params.ttlSeconds ?? (isDelegated ? 15 * 60 : 30 * 24 * 3600)
  const now = Math.floor(Date.now() / 1000)
  const exp = now + ttl
  const payload = {
    typ: 'cli',
    sub: params.email,
    email: params.email,
    act: params.act,
    scope: params.scope ?? [],
    delegate: params.delegate ?? null,
  }
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(secret())
  return { token, expiresAt: exp }
}

export async function verifyCliToken(token: string): Promise<CliTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, audience: AUDIENCE })
    if (payload.typ !== 'cli') return null
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null
    if (payload.act !== 'human' && payload.act !== 'agent') return null
    return payload as unknown as CliTokenPayload
  }
  catch {
    return null
  }
}
