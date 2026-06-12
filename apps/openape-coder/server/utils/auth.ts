// story: coder-sign-in, coder-invite-members (#585).
//
// Caller resolution for coder.openape.ai, mirroring openape-chat's auth.ts:
// a caller arrives either through the browser SP session cookie (set by
// @openape/nuxt-auth-sp after the DDISA OAuth callback) or through a verified
// bearer token (CLI / agent). Both paths surface the same {email, act} shape so
// route handlers never branch on caller type.
//
// `requireUser` is the base gate every content endpoint runs first (401 without
// a valid session, no existence leak). `requireHuman` (in members.ts) adds the
// act:'human' assertion for project administration.

import type { H3Event } from 'h3'
import { createRemoteJWKS, verifyJWT } from '@openape/core'
import { decodeProtectedHeader } from 'jose'
// `verifyCliToken`, `getSpSession`, `createError`, `getHeader` and
// `useRuntimeConfig` are auto-imported (SP module + nitro) at runtime.

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

function extractBearer(event: H3Event): string | null {
  const header = getHeader(event, 'authorization') || getHeader(event, 'Authorization')
  if (header && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim() || null
  }
  return null
}

async function verifyBearer(token: string): Promise<Caller> {
  let alg: string | undefined
  try {
    alg = decodeProtectedHeader(token).alg
  }
  catch {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }

  // HS256 = SP-scoped CLI token minted by /api/cli/exchange (verified locally
  // with the session secret). Anything else goes through the IdP JWKS path.
  if (alg === 'HS256') {
    const cli = await verifyCliToken(token)
    if (!cli) {
      throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
    }
    return { email: cli.email.toLowerCase(), act: cli.act, source: 'bearer' }
  }

  try {
    const { payload } = await verifyJWT<DDISAClaims>(token, getJwks())
    if (!payload.sub) {
      throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
    }
    return {
      email: payload.sub.toLowerCase(),
      act: payload.act === 'agent' ? 'agent' : 'human',
      source: 'bearer',
    }
  }
  catch (err) {
    if (err && typeof err === 'object' && 'statusCode' in err) throw err
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
}

/**
 * Resolves the signed-in caller from a bearer token or the SP session cookie.
 * Throws a uniform 401 (no existence leak) when there is no — or an expired —
 * session. Email is lower-cased once at the boundary so every membership lookup
 * downstream compares the same string regardless of IdP casing.
 */
export async function resolveCaller(event: H3Event): Promise<Caller> {
  const bearer = extractBearer(event)
  if (bearer) {
    return await verifyBearer(bearer)
  }

  const session = await getSpSession(event)
  const claims = (session.data as { claims?: DDISAClaims })?.claims
  if (!claims?.sub) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
  return {
    email: claims.sub.toLowerCase(),
    act: claims.act === 'agent' ? 'agent' : 'human',
    source: 'cookie',
  }
}

/**
 * Base gate for every content endpoint: returns the signed-in user's email or
 * throws 401. On first authenticated access a pending invite is realised into a
 * membership (acceptInvite), so an invited person becomes a member the moment
 * they sign in.
 */
export async function requireUser(event: H3Event): Promise<string> {
  const caller = await resolveCaller(event)
  await useMembershipStore().acceptPendingInvites(caller.email)
  return caller.email
}
