import type { JWTPayload } from 'jose'
import { normalizeActClaim } from '@openape/core'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { createError, defineEventHandler, readBody, setResponseStatus } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { signCliToken } from './cli-token'
import { resolveIssuerForToken } from './ddisa-issuer'
import { getSpConfig } from './sp-config'
import { assertSafeIdpUrl } from './ssrf-guard'

interface ExchangeBody {
  subject_token?: string
  scopes?: string[]
}

// RFC 8693 / DDISA-CLI: the IdP mints subject tokens with this audience for
// all first-party CLI flows (`apes login`). Delegation AuthZ-JWTs instead
// carry aud=<this SP's clientId> (sp-data-access.md §4); both are accepted.
const FIRST_PARTY_AUD = 'apes-cli'

let _idpJwks: ReturnType<typeof createRemoteJWKSet> | null = null
let _idpJwksUrl = ''

function getIdpJwks(idpUrl: string): ReturnType<typeof createRemoteJWKSet> {
  const url = new URL('/.well-known/jwks.json', idpUrl).toString()
  if (!_idpJwks || _idpJwksUrl !== url) {
    // Short timeout bounds the JWKS fetch (paired with the assertSafeIdpUrl
    // SSRF guard at the call site). Note: jose 5.x cannot refuse redirects on
    // this fetch — a redirect-to-internal bypass remains a documented residual.
    _idpJwks = createRemoteJWKSet(new URL(url), { timeoutDuration: 5000 })
    _idpJwksUrl = url
  }
  return _idpJwks
}

/**
 * Factory that returns an h3 event handler implementing RFC 8693-style
 * token exchange for the DDISA CLI + delegation flows.
 *
 * POST /api/cli/exchange
 *   Body: `{ subject_token: <jwt>, scopes?: string[] }`
 *   Response (201), first-party without scopes:
 *     `{ access_token, token_type: "Bearer", expires_at, aud }`
 *   Response (201), scoped/delegated:
 *     `{ access_token, token_type: "Bearer", expires_at, aud, scope, delegate }`
 *
 * Security contract (sp-data-access.md §5, consolidated per #1043 so EVERY
 * SP app serves the identical hardened exchange):
 * - Subject tokens must carry `aud='apes-cli'` (first-party) or
 *   `aud=<clientId>` (delegation AuthZ-JWT) — enforced by jose.
 * - Issuer is resolved dynamically via DDISA (never hardcoded), then run
 *   through the SSRF guard before its JWKS is fetched.
 * - A `delegation_grant` claim triggers a LIVE status check at the IdP —
 *   revoked grants are unusable within the token's TTL; an unreachable IdP
 *   fails closed with 502 (§5.4).
 * - Requested scopes must be inside the SP's published scope catalog
 *   (`openapeSp.manifest.scopes`, §3.2). SPs without a catalog skip this.
 * - A delegated token without a scope claim is rejected (protocol#6), and a
 *   present scope claim — even `[]` — is a hard bound: narrowing is allowed,
 *   widening never (§5.2, #1035).
 * - The first-party path (string act, no scope claim, no requested scopes)
 *   mints a token byte-identical to the pre-scope shape.
 */
export function createCliExchangeHandler() {
  return defineEventHandler(async (event) => {
    const body = await readBody<ExchangeBody>(event)
    if (!body?.subject_token || typeof body.subject_token !== 'string') {
      throw createError({ statusCode: 400, statusMessage: 'subject_token required' })
    }

    // DDISA: resolve the authoritative issuer from the SUBJECT's domain
    // (protocol sp-data-access.md §2.1) — never a hardcoded/configured single
    // issuer, no allowlist.
    const resolved = await resolveIssuerForToken(body.subject_token)
    if (!resolved) {
      throw createError({
        statusCode: 401,
        statusMessage: 'subject_token has no usable subject claim',
        data: { detail: 'Expected sub to be an email address.' },
      })
    }
    const idpUrl = resolved.issuer

    // SSRF guard: the issuer was resolved from the subject's DDISA record
    // (attacker-influenceable). Refuse non-https or private/loopback targets
    // before fetching their JWKS.
    try {
      await assertSafeIdpUrl(idpUrl)
    }
    catch (err) {
      const detail = err instanceof Error ? err.message : 'issuer rejected'
      throw createError({
        statusCode: 502,
        statusMessage: 'IdP issuer not permitted',
        data: { detail },
      })
    }

    const { clientId } = getSpConfig()
    const acceptedAudiences = [FIRST_PARTY_AUD, clientId].filter(Boolean)

    let claims: JWTPayload
    try {
      const verified = await jwtVerify(body.subject_token, getIdpJwks(idpUrl), {
        issuer: idpUrl,
        audience: acceptedAudiences,
      })
      claims = verified.payload
    }
    catch (err) {
      const detail = err instanceof Error ? err.message : 'verify failed'
      throw createError({
        statusCode: 401,
        statusMessage: 'Invalid subject_token',
        data: { detail: `Token must be issued by ${idpUrl} with aud in [${acceptedAudiences.join(', ')}]. ${detail}` },
      })
    }

    const sub = claims.sub
    if (typeof sub !== 'string' || !sub.includes('@')) {
      throw createError({
        statusCode: 401,
        statusMessage: 'subject_token has no usable subject claim',
        data: { detail: 'Expected sub to be an email address.' },
      })
    }

    // Polymorphic claim: a delegation OBJECT must mint an agent token,
    // never a human one (#1034) — normalizeActClaim fails closed.
    const act = normalizeActClaim(claims.act)

    // Revocation check (sp-data-access §5.4): a delegation AuthZ-JWT carries
    // the `delegation_grant` id. Expiry is visible in the token itself, but the
    // Owner can REVOKE a standing grant mid-life — only a live check at the IdP
    // catches that. GET /api/grants/:id is unauthenticated status
    // introspection. Fail closed: anything but `approved` — or an unreachable
    // IdP — rejects, so a revoked grant is not exchangeable within its TTL.
    const grantId = (claims as { delegation_grant?: unknown }).delegation_grant
    if (typeof grantId === 'string' && grantId) {
      let grantStatus: string | undefined
      try {
        const res = await fetch(`${idpUrl}/api/grants/${encodeURIComponent(grantId)}`)
        if (res.status === 404) {
          grantStatus = 'not_found'
        }
        else if (!res.ok) {
          throw new Error(`grant status endpoint answered ${res.status}`)
        }
        else {
          grantStatus = ((await res.json()) as { status?: string })?.status
        }
      }
      catch (err) {
        throw createError({
          statusCode: 502,
          statusMessage: 'could not verify delegation grant status',
          data: { detail: err instanceof Error ? err.message : String(err) },
        })
      }
      if (grantStatus !== 'approved') {
        throw createError({
          statusCode: 401,
          statusMessage: 'delegation grant not active',
          data: { detail: `grant ${grantId} is ${grantStatus} (revoked, expired, or not approved)` },
        })
      }
    }

    // tokenScopes is null only when the token carries NO scope claim at all —
    // distinct from scope:[], which is a real (empty) bound.
    const tokenScopes = parseTokenScopes(claims)

    // Delegation detection on the RAW claim: normalizeActClaim also maps an
    // ABSENT act to 'agent', which would misclassify first-party tokens here.
    // Besides the RFC 8693 object form, a delegation audience or a grant
    // marker claim identifies a delegated token (sp-data-access §4/§5.1).
    const audClaim = claims.aud
    const isFirstPartyAud = audClaim === FIRST_PARTY_AUD
      || (Array.isArray(audClaim) && audClaim.includes(FIRST_PARTY_AUD))
    const isDelegated = (typeof claims.act === 'object' && claims.act !== null)
      || !isFirstPartyAud
      || typeof grantId === 'string'
      || typeof (claims as { grant_id?: unknown }).grant_id === 'string'

    // protocol#6: a delegated token MUST state its own bounds — a foreign or
    // pre-#1039 IdP can still mint delegations without `scope`, and treating
    // that as "free pick from the catalog" would let the delegate self-grant
    // everything. Fail closed. First-party tokens (string act, no scope claim)
    // stay unrestricted per sp-data-access §5.3.
    if (isDelegated && tokenScopes === null) {
      throw createError({
        statusCode: 401,
        statusMessage: 'delegated token carries no scope claim',
        data: { detail: 'A delegation subject_token must carry a scope claim (openape-ai/protocol#6). Re-issue the token from an IdP that embeds the delegation grant\'s scopes.' },
      })
    }

    const requestedScopes = Array.isArray(body.scopes) ? body.scopes : (tokenScopes ?? [])

    // sp-data-access §3.2: requested scopes must be a subset of the SP's own
    // published catalog (`openapeSp.manifest.scopes`, array form per
    // sp-scope-catalog.json — the catalog is the set of entry `id`s). SPs that
    // publish no catalog keep today's behaviour: no catalog check.
    const config = useRuntimeConfig(event)
    const rawCatalog = ((config.openapeSp as unknown as { manifest?: { scopes?: Array<{ id: string }> } } | undefined)
      ?.manifest
      ?.scopes)
    if (Array.isArray(rawCatalog)) {
      const catalog = rawCatalog.map(s => s.id)
      const unknown = requestedScopes.filter(s => !catalog.includes(s))
      if (unknown.length > 0) {
        throw createError({
          statusCode: 400,
          statusMessage: 'invalid_scope',
          data: { detail: `unknown scopes: ${unknown.join(', ')}. Catalog: ${catalog.join(', ') || '(none)'}.` },
        })
      }
    }

    // A present scope claim bounds the exchange even when empty: scope:[]
    // means "nothing", not "no restriction" (#1035). Receivers MAY narrow
    // scope at exchange; never widen (§5.2).
    if (tokenScopes !== null) {
      const widenedBy = requestedScopes.filter(s => !tokenScopes.includes(s))
      if (widenedBy.length > 0) {
        throw createError({
          statusCode: 400,
          statusMessage: 'invalid_scope',
          data: { detail: `cannot widen beyond grant scopes: ${widenedBy.join(', ')}` },
        })
      }
    }

    setResponseStatus(event, 201)

    // Pure first-party (no scope claim, nothing requested, not delegated):
    // token AND response stay byte-identical to the pre-#1043 shape — this is
    // the path every CLI login (`apes login` → SP-bearer) depends on.
    const isScopedExchange = isDelegated || tokenScopes !== null || Array.isArray(body.scopes)
    if (!isScopedExchange) {
      const { token, expiresAt } = await signCliToken({ email: sub, act })
      return {
        access_token: token,
        token_type: 'Bearer' as const,
        expires_at: expiresAt,
        aud: clientId,
      }
    }

    // delegate provenance: prefer the spec's `delegate` claim (sp-data-access
    // §5.3 via delegation.md §5), fall back to the RFC 8693 act object.
    const delegate = extractDelegate(claims)

    const { token, expiresAt } = await signCliToken({
      email: sub,
      act,
      scope: requestedScopes,
      delegate,
    })

    return {
      access_token: token,
      token_type: 'Bearer' as const,
      expires_at: expiresAt,
      aud: clientId,
      scope: requestedScopes,
      delegate,
    }
  })
}

// null = the token has NO scope claim; [] = it has one that grants nothing.
// The caller needs the difference to fail closed on scope-less delegations
// (protocol#6) without touching first-party tokens.
function parseTokenScopes(claims: JWTPayload): string[] | null {
  // RFC 8693 / OAuth: `scope` is a space-separated string OR array
  const raw = (claims as { scope?: unknown }).scope ?? (claims as { scopes?: unknown }).scopes
  if (raw === undefined || raw === null) return null
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string')
  if (typeof raw === 'string') return raw.split(/\s+/).filter(Boolean)
  // present but unparseable → an empty bound, not "unbounded"
  return []
}

function extractDelegate(claims: JWTPayload): string | null {
  const d = (claims as { delegate?: unknown }).delegate
  if (typeof d === 'string') return d
  if (d && typeof d === 'object' && typeof (d as { sub?: unknown }).sub === 'string') {
    return (d as { sub: string }).sub
  }
  // RFC 8693 act fallback
  const act = (claims as { act?: unknown }).act
  if (act && typeof act === 'object' && typeof (act as { sub?: unknown }).sub === 'string') {
    return (act as { sub: string }).sub
  }
  return null
}
