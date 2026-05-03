import type { JWTPayload } from 'jose'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { signCliToken } from '../../utils/cli-token'

interface ExchangeBody {
  subject_token?: string
  scopes?: string[]
}

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
 * POST /api/cli/exchange — RFC 8693-style token exchange.
 *
 * Accepts an IdP-issued subject_token (signed by id.openape.ai with
 * `aud='apes-cli'`), verifies it via JWKS, and mints an HS256 SP-scoped
 * token for chat.openape.ai. The CLI side (`@openape/cli-auth`
 * `getAuthorizedBearer`) caches the result at
 * ~/.config/apes/sp-tokens/chat.openape.ai.json so subsequent ape-chat
 * commands skip this endpoint until the SP-token expires (30 days).
 *
 * Body:    `{ subject_token: <jwt>, scopes?: string[] }`
 * Response (201): `{ access_token, token_type: "Bearer", expires_at, aud, scopes? }`
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<ExchangeBody>(event)
  if (!body?.subject_token || typeof body.subject_token !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'subject_token required' })
  }

  const idpUrl = useRuntimeConfig().public.idpUrl as string
  if (!idpUrl) {
    throw createError({ statusCode: 500, statusMessage: 'IdP URL not configured' })
  }

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

  setResponseStatus(event, 201)
  return {
    access_token: token,
    token_type: 'Bearer' as const,
    expires_at: expiresAt,
    aud: 'chat.openape.ai',
    ...(Array.isArray(body.scopes) ? { scopes: body.scopes } : {}),
  }
})
