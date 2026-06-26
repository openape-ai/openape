import { SignJWT, jwtVerify } from 'jose'
import { useRuntimeConfig } from 'nitropack/runtime'
import { createError } from 'h3'

/**
 * Testrun-extended CLI token payload — adds optional `scope` for delegation
 * (sp-data-access.md §5). The shared @openape/nuxt-auth-sp signCliToken does
 * not carry scope; this local variant is used when a delegation subject_token
 * was exchanged and the minted SP token must encode its granted scope subset.
 */
export interface TestrunCliTokenPayload {
  iss: string
  aud: string
  typ: 'cli'
  sub: string
  email: string
  act: 'human' | 'agent'
  /** Delegated tokens only — granted scope subset (sp-data-access.md §5). */
  scope?: string[]
  iat: number
  exp: number
}

function spConfig(): { clientId: string, sessionSecret: string } {
  const cfg = useRuntimeConfig().openapeSp as { clientId?: string, sessionSecret?: string } | undefined
  const clientId = cfg?.clientId || 'testrun.openape.ai'
  const sessionSecret = cfg?.sessionSecret || ''
  return { clientId, sessionSecret }
}

function secret(): Uint8Array {
  const { sessionSecret } = spConfig()
  if (!sessionSecret || sessionSecret.length < 32) {
    throw createError({ statusCode: 500, statusMessage: 'CLI token secret not configured (openapeSp.sessionSecret < 32 chars)' })
  }
  return new TextEncoder().encode(sessionSecret)
}

/**
 * Mint an HS256 SP-scoped CLI token. Secret and issuer/aud come from
 * `openapeSp.sessionSecret` / `openapeSp.clientId` so this is consistent
 * with the shared `signCliToken` from @openape/nuxt-auth-sp for first-party
 * tokens. Delegation tokens additionally embed a `scope` claim and use a
 * short TTL (15 min) per sp-data-access.md §5.4.
 *
 * Named `signTestrunCliToken` to avoid colliding with the auto-imported
 * `signCliToken` from @openape/nuxt-auth-sp.
 */
export async function signTestrunCliToken(params: {
  email: string
  act: 'human' | 'agent'
  scope?: string[]
  ttlSeconds?: number
}): Promise<{ token: string, expiresAt: number }> {
  const { clientId } = spConfig()
  // Delegated tokens (scope present) → short TTL (sp-data-access.md §5.4).
  const ttl = params.ttlSeconds ?? (params.scope ? 15 * 60 : 30 * 24 * 3600)
  const now = Math.floor(Date.now() / 1000)
  const exp = now + ttl
  const payload: Record<string, unknown> = { typ: 'cli', sub: params.email, email: params.email, act: params.act }
  if (params.scope && params.scope.length > 0) payload.scope = params.scope
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(clientId)
    .setAudience(clientId)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(secret())
  return { token, expiresAt: exp }
}

/**
 * Verify a testrun-minted CLI bearer token (HS256, self-issued).
 * Named `verifyTestrunCliToken` to avoid colliding with the auto-imported
 * `verifyCliToken` from @openape/nuxt-auth-sp.
 */
export async function verifyTestrunCliToken(token: string): Promise<TestrunCliTokenPayload | null> {
  const { clientId } = spConfig()
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: clientId, audience: clientId })
    if (payload.typ !== 'cli') return null
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null
    if (payload.act !== 'human' && payload.act !== 'agent') return null
    if (payload.scope !== undefined && !Array.isArray(payload.scope)) return null
    return payload as unknown as TestrunCliTokenPayload
  }
  catch {
    return null
  }
}
