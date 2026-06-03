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
  ttlSeconds?: number
}): Promise<{ token: string, expiresAt: number }> {
  const { clientId } = getSpConfig()
  const ttl = params.ttlSeconds ?? 30 * 24 * 3600
  const now = Math.floor(Date.now() / 1000)
  const exp = now + ttl
  const payload = { typ: 'cli', sub: params.email, email: params.email, act: params.act }
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
    return payload as unknown as CliTokenPayload
  }
  catch {
    return null
  }
}
