import type { H3Event } from 'h3'
import { createRemoteJWKS, verifyJWT } from '@openape/core'
import { decodeProtectedHeader } from 'jose'
import { verifyCliToken } from './cli-token'

// `getSpSession`, `createError`, `getHeader`, `getQuery`, and `useRuntimeConfig`
// are all auto-imported by Nuxt 4 (the SP module + nitro), so we don't import
// them explicitly here.

export interface Caller {
  email: string
  act: 'human' | 'agent'
  source: 'cookie' | 'bearer'
}

interface DDISAClaims {
  sub?: string
  act?: 'human' | 'agent' | string
}

let _jwksCache: ReturnType<typeof createRemoteJWKS> | null = null

function getJwks() {
  if (!_jwksCache) {
    const idpUrl = useRuntimeConfig().public.idpUrl as string
    const url = new URL('/.well-known/jwks.json', idpUrl).toString()
    _jwksCache = createRemoteJWKS(url)
  }
  return _jwksCache
}

/**
 * Unifies the two ways a caller can hit chat.openape.ai:
 *
 * 1. Web UI — browser cookie session set by `@openape/nuxt-auth-sp` after the
 *    DDISA OAuth callback. Stored claims live on `session.data.claims`.
 * 2. Plugin / agent — `Authorization: Bearer <token>` (HTTP) or `?token=<bearer>`
 *    (WebSocket query). Verified against the IdP's JWKS.
 *
 * Both paths surface the same shape so route handlers don't branch on caller
 * type. `act` defaults to `'human'` if a token doesn't carry the claim.
 */
export async function resolveCaller(event: H3Event): Promise<Caller> {
  const bearer = extractBearer(event)
  if (bearer) {
    return await verifyBearer(bearer)
  }

  const session = await getSpSession(event)
  const claims = (session.data as { claims?: DDISAClaims })?.claims
  if (!claims?.sub) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }
  return {
    // Lower-case once at the boundary so every downstream comparison
    // (membership rows, message ownership, contacts canonicalisation,
    // bridge allowlist) sees the same string regardless of how the IdP
    // emitted the casing — see #282.
    email: claims.sub.toLowerCase(),
    act: claims.act === 'agent' ? 'agent' : 'human',
    source: 'cookie',
  }
}

/** Same as `resolveCaller` but returns `null` instead of throwing on 401. */
export async function tryResolveCaller(event: H3Event): Promise<Caller | null> {
  try {
    return await resolveCaller(event)
  }
  catch {
    return null
  }
}

function extractBearer(event: H3Event): string | null {
  const header = getHeader(event, 'authorization') || getHeader(event, 'Authorization')
  if (header && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim() || null
  }
  // WebSocket upgrade requests can't carry custom headers reliably across
  // browsers, so we accept ?token=… on the upgrade URL instead.
  const q = getQuery(event)
  const t = q.token
  if (typeof t === 'string' && t.length > 0) return t
  return null
}

async function verifyBearer(token: string): Promise<Caller> {
  // Dispatch on alg in the protected header. HS256 = SP-scoped CLI token
  // minted by /api/cli/exchange (verified locally with the session secret).
  // Anything else (RS256/ES256/EdDSA) goes through the IdP JWKS path.
  let alg: string | undefined
  try {
    alg = decodeProtectedHeader(token).alg
  }
  catch {
    throw createError({ statusCode: 401, statusMessage: 'Malformed bearer token' })
  }

  if (alg === 'HS256') {
    const cli = await verifyCliToken(token)
    if (!cli) {
      throw createError({ statusCode: 401, statusMessage: 'Invalid CLI token' })
    }
    return { email: cli.email.toLowerCase(), act: cli.act, source: 'bearer' }
  }

  try {
    const { payload } = await verifyJWT<DDISAClaims>(token, getJwks())
    const email = payload.sub
    if (!email) {
      throw createError({ statusCode: 401, statusMessage: 'Token missing sub' })
    }
    return {
      email: email.toLowerCase(),
      act: payload.act === 'agent' ? 'agent' : 'human',
      source: 'bearer',
    }
  }
  catch (err) {
    if (err && typeof err === 'object' && 'statusCode' in err) throw err
    throw createError({ statusCode: 401, statusMessage: 'Invalid bearer token' })
  }
}
