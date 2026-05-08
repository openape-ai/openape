import type { H3Event } from 'h3'
import { createRemoteJWKS, verifyJWT } from '@openape/core'

// Two distinct auth tracks because owner-side and agent-side endpoints
// have different identity sources:
//
//   * Owner uses the browser session cookie set by @openape/nuxt-auth-sp
//     after the DDISA OAuth callback. `requireOwner` resolves the email
//     from that session.
//
//   * Agent uses a Bearer DDISA agent JWT (act:'agent', sub=agent
//     email). `requireAgent` verifies it against the IdP's JWKS.
//
// Owners must never reach /me/* endpoints (those are for the agent's
// own self-introduction and task pull). Agents must never reach
// /agents/:name/tasks mutations (only owners manage tasks). The two
// helpers enforce that split — never call requireOwner on a /me/*
// route or vice versa.

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

function problem(status: number, title: string): never {
  throw createError({
    statusCode: status,
    statusMessage: title,
    data: { type: 'about:blank', status, title },
  })
}

/**
 * Resolve owner email from the @openape/nuxt-auth-sp session cookie.
 * Throws 401 if no session or the session is missing claims.sub.
 */
export async function requireOwner(event: H3Event): Promise<string> {
  const session = await getSpSession(event)
  const claims = (session.data as { claims?: DDISAClaims })?.claims
  const email = claims?.sub
  if (!email) problem(401, 'Authentication required')
  return email
}

/**
 * Verify a DDISA agent JWT in the Authorization header. Requires
 * act:'agent' so a copied user JWT can't be used to call the agent
 * endpoints. Returns the agent's email (sub claim).
 */
export async function requireAgent(event: H3Event): Promise<string> {
  const auth = getHeader(event, 'Authorization')
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
    problem(401, 'Bearer agent JWT required')
  }
  const token = auth.slice(7).trim()
  const idpUrl = useRuntimeConfig().public.idpUrl as string
  let claims: DDISAClaims
  try {
    // No audience check for v1: the IdP's `/api/agent/authenticate`
    // currently issues tokens without committing to a specific
    // audience, and we don't want to require operators to re-issue
    // every agent token when a new SP comes online. Defence in
    // depth: signature + issuer + act='agent' + sub is enough
    // because the agent JWT is a sealed token bound to the keypair
    // we registered at IdP-enroll, not a bearer trivially copyable
    // across SPs.
    //
    // verifyJWT returns { payload, protectedHeader } — extract the
    // payload before reading claims (treating the wrapper object as
    // the claims silently produces `act: undefined` and rejects every
    // valid agent token with a 403).
    const result = await verifyJWT(token, getJwks(), { issuer: idpUrl })
    claims = result.payload as DDISAClaims
  }
  catch {
    problem(401, 'Invalid or expired agent JWT')
  }
  if (claims.act !== 'agent') {
    problem(403, 'agent JWT required (act != "agent")')
  }
  if (typeof claims.sub !== 'string') {
    problem(401, 'agent JWT has no sub claim')
  }
  return claims.sub
}
