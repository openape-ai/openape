import { jwtVerify, SignJWT } from 'jose'
import { useRuntimeConfig } from 'nitropack/runtime'
import { createError } from 'h3'
import { getSpConfig } from './sp-config'

export interface CliTokenPayload {
  iss: string
  aud: string
  typ: 'cli'
  sub: string
  email: string
  act: 'human' | 'agent'
  /** Scoped exchanges only — granted scope subset (sp-data-access.md §5). */
  scope?: string[]
  /** Provenance audit — the delegate behind a delegated exchange (§5.3). */
  delegate?: string | null
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
 * Mint an HS256 SP-scoped CLI token. 30-day lifetime by default; clients
 * cache it at ~/.config/apes/sp-tokens/<clientId>.json. Issued from
 * the /api/cli/exchange endpoint after the IdP-issued subject_token has
 * been verified via JWKS.
 *
 * The issuer and audience are derived from `openapeSp.clientId` (the SP's
 * own domain, e.g. `chat.openape.ai`) so this util is fully config-driven
 * and requires no app-specific overrides.
 */
export async function signCliToken(params: {
  email: string
  act: 'human' | 'agent'
  /**
   * Scoped exchanges carry their granted scope subset (sp-data-access.md §5)
   * — embedded even when empty, because `scope: []` is a real bound ("nothing"),
   * not "unrestricted" (#1035). Omitting the parameter entirely mints the
   * legacy first-party token, byte-identical to the pre-scope shape.
   */
  scope?: string[]
  /** Delegate provenance (sp-data-access §5.3); rides along with `scope`. */
  delegate?: string | null
  ttlSeconds?: number
}): Promise<{ token: string, expiresAt: number }> {
  const { clientId } = getSpConfig()
  // Spec recommends ≤15 min for delegated tokens (sp-data-access §6);
  // first-party keeps the 30-day CLI-cache lifetime.
  const isDelegated = Boolean(params.scope?.length || params.delegate)
  const ttl = params.ttlSeconds ?? (isDelegated ? 15 * 60 : 30 * 24 * 3600)
  const now = Math.floor(Date.now() / 1000)
  const exp = now + ttl
  const payload: Record<string, unknown> = { typ: 'cli', sub: params.email, email: params.email, act: params.act }
  if (params.scope !== undefined) {
    payload.scope = params.scope
    payload.delegate = params.delegate ?? null
  }
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(clientId)
    .setAudience(clientId)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(secret())
  return { token, expiresAt: exp }
}

export async function verifyCliToken(token: string): Promise<CliTokenPayload | null> {
  const { clientId } = getSpConfig()
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: clientId, audience: clientId })
    if (payload.typ !== 'cli') return null
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null
    if (payload.act !== 'human' && payload.act !== 'agent') return null
    if (payload.scope !== undefined && !Array.isArray(payload.scope)) return null
    if (payload.delegate !== undefined && payload.delegate !== null && typeof payload.delegate !== 'string') return null
    return payload as unknown as CliTokenPayload
  }
  catch {
    return null
  }
}
