import type { JWTPayload } from 'jose'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { useRuntimeConfig } from 'nitropack/runtime'
import { signCliToken } from '../../utils/cli-token'
import { resolveIssuerForToken } from '../../utils/ddisa-issuer'
import { scopesAreCovered } from '../../utils/scope-catalog'

interface ExchangeBody {
  subject_token?: string
  scopes?: string[]
}

// We accept BOTH the apes-cli audience (first-party CLI flows like
// `apes login` → SP-bearer cache) AND troop's own DDISA domain
// (delegation flows per sp-data-access.md §4, where the IdP mints an
// AuthZ-JWT with aud=<sp-domain> for the delegate). Either form is
// trusted because it was signed by the subject's DDISA-resolved IdP.
//
// troop's own domain is its configured SP client_id — config-derived, not
// hardcoded, so non-prod hosts (troop.openape.test) work too.
function ownDomain(): string {
  const config = useRuntimeConfig()
  return String((config.openapeSp as { clientId?: string })?.clientId ?? 'troop.openape.ai')
}

let _idpJwks: ReturnType<typeof createRemoteJWKSet> | null = null
let _idpJwksUrl = ''

function getIdpJwks(idpUrl: string): ReturnType<typeof createRemoteJWKSet> {
  const url = new URL('/.well-known/jwks.json', idpUrl).toString()
  if (!_idpJwks || _idpJwksUrl !== url) {
    _idpJwks = createRemoteJWKSet(new URL(url))
    _idpJwksUrl = url
  }
  return _idpJwks
}

/**
 * POST /api/cli/exchange — RFC 8693-style token exchange.
 *
 * Pattern copied from openape-chat (the canonical reference impl for
 * SP-data-access). Differences here:
 *   - audience accept-list is ['apes-cli', 'troop.openape.ai'] so
 *     both first-party CLI tokens AND delegation-AuthZ-JWTs work
 *   - request body `scopes` (optional) is intersected with troop's
 *     published scope catalog; unknown scopes → 400
 *   - minted CLI token carries the verified `scope` claim + the
 *     `delegate` (sp-data-access §5.3 provenance) for downstream
 *     scope-aware route handlers to enforce
 *
 * Body:    `{ subject_token: <jwt>, scopes?: string[] }`
 * Response (201): `{ access_token, token_type: "Bearer",
 *                    expires_at, aud, scope, delegate }`
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<ExchangeBody>(event)
  if (!body?.subject_token || typeof body.subject_token !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'subject_token required' })
  }

  // DDISA: resolve the authoritative issuer from the SUBJECT's domain
  // (protocol sp-data-access.md §2.1). Never hardcode or allowlist on
  // this path.
  const resolved = await resolveIssuerForToken(body.subject_token)
  if (!resolved) {
    throw createError({
      statusCode: 401,
      statusMessage: 'subject_token has no usable subject claim',
      data: { detail: 'Expected sub to be an email address.' },
    })
  }
  const idpUrl = resolved.issuer
  const acceptedAudiences = ['apes-cli', ownDomain()]

  let claims: JWTPayload
  try {
    // jose's audience option accepts string|string[]; matches if any
    // audience in the token equals any in the list.
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

  const act = (claims as { act?: string }).act === 'agent' ? 'agent' : 'human'

  // sp-data-access §5.2: scopes in the request body must be a subset
  // of (a) the catalog, AND (b) the delegation grant's scopes if any.
  // The grant's scopes ride in the token claim `scope` per the spec.
  // Receivers MAY narrow scope at exchange; never widen.
  const tokenScopes = parseTokenScopes(claims)
  const requestedScopes = Array.isArray(body.scopes) ? body.scopes : tokenScopes
  const catalogCheck = scopesAreCovered(requestedScopes)
  if (!catalogCheck.ok) {
    throw createError({
      statusCode: 400,
      statusMessage: 'invalid_scope',
      data: { detail: `unknown scopes: ${catalogCheck.unknown.join(', ')}` },
    })
  }
  if (tokenScopes.length > 0) {
    const widenedBy = requestedScopes.filter(s => !tokenScopes.includes(s))
    if (widenedBy.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'invalid_scope',
        data: { detail: `cannot widen beyond grant scopes: ${widenedBy.join(', ')}` },
      })
    }
  }

  // delegate provenance: prefer the spec's `delegate` claim (sp-data-
  // access §5.3 via delegation.md §5), fall back to `request.delegate`
  // shape if the IdP doesn't yet emit the flat claim.
  const delegate = extractDelegate(claims)

  const { token, expiresAt } = await signCliToken({
    email: sub,
    act,
    scope: requestedScopes,
    delegate,
  })

  setResponseStatus(event, 201)
  return {
    access_token: token,
    token_type: 'Bearer' as const,
    expires_at: expiresAt,
    aud: ownDomain(),
    scope: requestedScopes,
    delegate,
  }
})

function parseTokenScopes(claims: JWTPayload): string[] {
  // RFC 8693 / OAuth: `scope` is a space-separated string OR array
  const raw = (claims as { scope?: unknown }).scope ?? (claims as { scopes?: unknown }).scopes
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string')
  if (typeof raw === 'string') return raw.split(/\s+/).filter(Boolean)
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
