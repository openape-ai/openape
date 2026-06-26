import { createRemoteJWKSet, jwtVerify } from 'jose'
import { createError, defineEventHandler, setResponseStatus } from 'h3'
import { signPrCliToken } from '../../utils/cli-token'

// Auto-imported from @openape/nuxt-auth-sp via addServerImportsDir:
//   resolveIssuerForToken, assertSafeIdpUrl, getSpConfig

interface ExchangeBody {
  subject_token?: string
  scopes?: string[]
}

/**
 * POST /api/cli/exchange — RFC 8693-style token exchange.
 *
 * Extends the standard DDISA CLI flow (which only accepts `aud='apes-cli'`)
 * with a delegation path: tokens with `aud=pr.openape.ai` or carrying a
 * `grant_id` claim are treated as Receiver delegation tokens
 * (sp-data-access.md §5.1) and validated for scope against the SP manifest.
 *
 * Body: `{ subject_token: <jwt>, scopes?: string[] }`
 *
 * Response (201): `{ access_token, token_type: "Bearer", expires_at, aud, scopes? }`
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<ExchangeBody>(event)
  if (!body?.subject_token || typeof body.subject_token !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'subject_token required' })
  }

  // DDISA: resolve the authoritative issuer from the SUBJECT's domain
  // (protocol sp-data-access.md §2.1) — never hardcoded, no allowlist.
  const resolved = await resolveIssuerForToken(body.subject_token)
  if (!resolved) {
    throw createError({
      statusCode: 401,
      statusMessage: 'subject_token has no usable subject claim',
      data: { detail: 'Expected sub to be an email address.' },
    })
  }

  // SSRF guard: reject non-https or private/loopback DDISA-resolved issuers
  // before fetching their JWKS (inherited from @openape/nuxt-auth-sp 0.11).
  try {
    await assertSafeIdpUrl(resolved.issuer)
  }
  catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: 'IdP issuer not permitted',
      data: { detail: err instanceof Error ? err.message : 'issuer rejected' },
    })
  }

  // Verify the token against the DDISA-resolved issuer's JWKS.
  // We do NOT set audience here so that both aud='apes-cli' (first-party) and
  // aud='pr.openape.ai' (delegation) pass jose's validation. We check aud
  // manually below.
  const jwks = createRemoteJWKSet(new URL(resolved.jwksUri), { timeoutDuration: 5000 })
  let claims: Record<string, unknown>
  try {
    const { payload } = await jwtVerify(body.subject_token, jwks, {
      issuer: resolved.issuer,
    })
    claims = payload as unknown as Record<string, unknown>
  }
  catch (err) {
    const detail = err instanceof Error ? err.message : 'verify failed'
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid subject_token',
      data: { detail: `Token must be issued by ${resolved.issuer}. ${detail}` },
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

  const act = claims.act === 'agent' ? 'agent' : 'human'
  const { clientId } = getSpConfig()

  const FIRST_PARTY_AUD = 'apes-cli'
  const aud = typeof claims.aud === 'string' ? claims.aud : undefined
  const isFirstParty = aud === FIRST_PARTY_AUD
  const isDelegation = aud === clientId || typeof claims.grant_id === 'string'
  if (!isFirstParty && !isDelegation) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid subject_token',
      data: {
        detail: `aud must be "${FIRST_PARTY_AUD}" (first-party) or "${clientId}" (delegation); got "${aud ?? '(none)'}".`,
      },
    })
  }

  // Delegation path: validate that the requested scopes are in the SP manifest.
  let grantedScope: string[] | undefined
  if (isDelegation) {
    const claimedScopes = claims.scopes ?? claims.scope
    const requested = Array.isArray(claimedScopes)
      ? claimedScopes.filter((s): s is string => typeof s === 'string')
      : []
    if (requested.length === 0) {
      throw createError({
        statusCode: 403,
        statusMessage: 'delegation_without_scope',
        data: { detail: 'A delegation subject_token must carry at least one scope.' },
      })
    }
    const config = useRuntimeConfig(event)
    // manifest.scopes is the array form (per sp-scope-catalog.json) — the
    // catalog is the set of entry `id`s. Cast via unknown to read the runtime
    // shape independent of the module's ManifestConfig typing.
    const rawScopes = ((config.openapeSp as unknown as { manifest?: { scopes?: Array<{ id: string }> } } | undefined)
      ?.manifest?.scopes)
    const catalog = Array.isArray(rawScopes) ? rawScopes.map(s => s.id) : []
    const notInCatalog = requested.filter(s => !catalog.includes(s))
    if (notInCatalog.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'invalid_scope',
        data: {
          detail: `Requested scope(s) not offered by this SP: ${notInCatalog.join(', ')}. Catalog: ${catalog.join(', ') || '(none)'}.`,
        },
      })
    }
    grantedScope = requested
  }

  // signPrCliToken is the local variant of signCliToken that additionally
  // supports scope for delegation tokens. It reads secret + clientId from
  // openapeSp.sessionSecret / openapeSp.clientId (same source as the shared
  // signCliToken from @openape/nuxt-auth-sp).
  const { token, expiresAt } = await signPrCliToken({
    email: sub,
    act,
    ...(grantedScope ? { scope: grantedScope } : {}),
  })

  setResponseStatus(event, 201)
  return {
    access_token: token,
    token_type: 'Bearer' as const,
    expires_at: expiresAt,
    aud: clientId,
    ...(grantedScope ? { scopes: grantedScope } : {}),
  }
})
