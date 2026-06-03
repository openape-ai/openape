import type { JWTPayload } from 'jose'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { createError, defineEventHandler, readBody, setResponseStatus } from 'h3'
import { signCliToken } from './cli-token'
import { resolveIssuerForToken } from './ddisa-issuer'
import { getSpConfig } from './sp-config'

interface ExchangeBody {
  subject_token?: string
  scopes?: string[]
}

// RFC 8693 / DDISA-CLI: the IdP mints subject tokens with this audience for
// all first-party CLI flows (`apes login`). SP-specific delegation audiences
// are intentionally NOT accepted here — this handler covers only the standard
// apes-cli → SP-scoped-token exchange. Apps that need additional audiences
// (e.g. troop's delegation flow) should implement their own handler.
const EXPECTED_AUD = 'apes-cli'

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
 * Factory that returns an h3 event handler implementing RFC 8693-style
 * token exchange for the standard DDISA CLI flow.
 *
 * POST /api/cli/exchange
 *   Body:    `{ subject_token: <jwt>, scopes?: string[] }`
 *   Response (201): `{ access_token, token_type: "Bearer", expires_at, aud, scopes? }`
 *
 * Security contract:
 * - Accepts IdP-issued subject_tokens with `aud='apes-cli'` only.
 * - Issuer is resolved dynamically via DDISA (_ddisa.<domain> TXT lookup),
 *   never hardcoded — per sp-data-access.md §2.1.
 * - Fully verifies the token against the resolved IdP's JWKS before minting
 *   any SP-scoped token. The unsafe sub-peek is only used for DDISA discovery
 *   and cannot benefit a forged token.
 * - Minted SP token uses `openapeSp.clientId` as both issuer and audience, so
 *   the SP self-attests its own domain — no global shared secret.
 * - SP token is HS256 signed with `openapeSp.sessionSecret` (≥32 chars
 *   enforced at sign time).
 *
 * Apps that need to accept additional subject_token audiences (e.g. delegation
 * tokens minted with `aud=<sp-domain>`) or carry extra claims (scope, delegate)
 * should NOT use this factory — implement a custom handler that calls
 * `signCliToken` directly after their own verification logic.
 */
export function createCliExchangeHandler() {
  return defineEventHandler(async (event) => {
    const body = await readBody<ExchangeBody>(event)
    if (!body?.subject_token || typeof body.subject_token !== 'string') {
      throw createError({ statusCode: 400, statusMessage: 'subject_token required' })
    }

    // DDISA: resolve the authoritative issuer from the SUBJECT's domain
    // (protocol sp-data-access.md §2.1) — never a hardcoded/configured single
    // issuer, no allowlist. Behaviour-preserving: domains without a DDISA
    // record (or pointing at id.openape.ai) resolve to id.openape.ai as before.
    const resolved = await resolveIssuerForToken(body.subject_token)
    if (!resolved) {
      throw createError({
        statusCode: 401,
        statusMessage: 'subject_token has no usable subject claim',
        data: { detail: 'Expected sub to be an email address.' },
      })
    }
    const idpUrl = resolved.issuer

    let claims: JWTPayload
    try {
      const verified = await jwtVerify(body.subject_token, getIdpJwks(idpUrl), {
        issuer: idpUrl,
        audience: EXPECTED_AUD,
      })
      claims = verified.payload
    }
    catch (err) {
      const detail = err instanceof Error ? err.message : 'verify failed'
      throw createError({
        statusCode: 401,
        statusMessage: 'Invalid subject_token',
        data: { detail: `Token must be issued by ${idpUrl} with aud=${EXPECTED_AUD}. ${detail}` },
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

    const { token, expiresAt } = await signCliToken({ email: sub, act })

    const { clientId } = getSpConfig()
    setResponseStatus(event, 201)
    return {
      access_token: token,
      token_type: 'Bearer' as const,
      expires_at: expiresAt,
      aud: clientId,
      ...(Array.isArray(body.scopes) ? { scopes: body.scopes } : {}),
    }
  })
}
