import type { H3Event } from 'h3'
import { createRemoteJWKS, verifyJWT } from '@openape/core'
import { verifyCliToken } from './cli-token'

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
  aud?: string | string[]
}

// Audience of tokens the `apes` CLI carries (IdP DEFAULT_CLI_AUDIENCE).
// Owner-bearer auth only accepts CLI-scoped human tokens — not arbitrary
// tokens minted for other purposes (#283 aud-scoping).
const CLI_AUDIENCE = 'apes-cli'

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
 * Resolve the owner email. Two transports for the SAME identity:
 *   1. The browser session cookie (DDISA OAuth callback) — the UI path.
 *   2. A Bearer DDISA *human* token with aud='apes-cli' — the CLI path
 *      (`apes agent deploy`, etc.). Verified against the IdP JWKS; the
 *      act='human' + aud='apes-cli' checks (#283) prevent an agent token
 *      or a token minted for another purpose from acting as the owner.
 * Throws 401 if neither yields an owner.
 */
export async function requireOwner(event: H3Event): Promise<string> {
  return (await resolveOwnerContext(event)).owner
}

/**
 * Resolve the owner email AND the set of scopes the caller is allowed
 * to exercise. Three transports:
 *
 *   1. **Browser session cookie** (UI path) — scopes are unbounded
 *      (the Owner-authenticated session can do anything Owner can).
 *   2. **IdP-issued human Bearer with aud='apes-cli'** (first-party
 *      CLI path) — scopes are unbounded for the same reason. This is
 *      a token Patrick himself minted via `apes login`.
 *   3. **troop-issued CLI token via /api/cli/exchange** (Receiver SP
 *      path per sp-data-access.md) — scopes are bounded to whatever
 *      the delegation grant carried. Route handlers MUST check via
 *      `requireOwnerWithScope`.
 *
 * The function preserves backwards compatibility: anything that called
 * `requireOwner` and got an unrestricted owner still works because
 * paths 1+2 return `{ scopes: null }` (= "no restriction").
 */
export async function resolveOwnerContext(event: H3Event): Promise<{
  owner: string
  /**
   * Effective scopes the caller may exercise. `null` = unrestricted
   *  (first-party). Non-null array = restrictive (delegation).
   */
  scopes: string[] | null
  /** Provenance: which SP-delegate the call rides on, if any. */
  delegate: string | null
}> {
  const session = await getSpSession(event)
  const sessionEmail = (session.data as { claims?: DDISAClaims })?.claims?.sub
  if (sessionEmail) return { owner: sessionEmail, scopes: null, delegate: null }

  const auth = getHeader(event, 'Authorization')
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim()

    // Try troop's own CLI-exchange token first (cheap HS256 verify
    // against the shared session secret). This is the path delegate
    // SPs use after token-exchange.
    const cli = await verifyCliToken(token)
    if (cli) {
      // A first-party human token (the Owner's own apes-cli session,
      // exchanged to a troop token) is unbounded — same status as the
      // session and IdP-human paths. Only delegated/agent tokens are
      // scope-bounded to what their token carries; a human's exchanged
      // token has scope=[] and must NOT collapse to "no scopes".
      if (cli.act === 'human' && !cli.delegate) {
        return { owner: cli.sub, scopes: null, delegate: null }
      }
      return { owner: cli.sub, scopes: cli.scope ?? [], delegate: cli.delegate ?? null }
    }

    // Fall back to IdP-issued human Bearer with aud='apes-cli'.
    const idpUrl = useRuntimeConfig().public.idpUrl as string
    try {
      const result = await verifyJWT(token, getJwks(), { issuer: idpUrl })
      const claims = result.payload as DDISAClaims
      const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
      if (claims.act === 'human' && auds.includes(CLI_AUDIENCE) && typeof claims.sub === 'string') {
        return { owner: claims.sub, scopes: null, delegate: null }
      }
    }
    catch { /* fall through to 401 */ }
  }
  problem(401, 'Authentication required')
}

/**
 * Owner-auth + scope enforcement. For routes that a Receiver SP may
 * call on the Owner's behalf via delegation. First-party paths
 * (session, apes-cli Bearer) auto-pass any scope check because their
 * effective scope is unbounded. Delegated paths must carry the
 * requested scope in their CLI token (minted at /api/cli/exchange).
 */
export async function requireOwnerWithScope(event: H3Event, requiredScope: string): Promise<{
  owner: string
  delegate: string | null
}> {
  const ctx = await resolveOwnerContext(event)
  if (ctx.scopes === null) return { owner: ctx.owner, delegate: ctx.delegate }
  if (!ctx.scopes.includes(requiredScope)) {
    problem(403, `scope '${requiredScope}' required (token carries: ${ctx.scopes.join(', ') || 'none'})`)
  }
  return { owner: ctx.owner, delegate: ctx.delegate }
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
