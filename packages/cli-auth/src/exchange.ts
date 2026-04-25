import { ofetch } from 'ofetch'
import { saveSpToken } from './storage.js'
import { AuthError   } from './types.js'
import type { IdpAuth, SpToken } from './types.js'

export interface ExchangeRequest {
  /** Endpoint of the SP that owns the exchange (e.g. `https://plans.openape.ai`). */
  endpoint: string
  /** Audience the SP advertises for its exchanged tokens (e.g. `plans.openape.ai`). */
  aud: string
  /** Optional scope hints the SP may use to scope-down the issued token. */
  scopes?: string[]
}

interface ExchangeResponse {
  access_token: string
  token_type: string
  expires_at?: number
  expires_in?: number
  aud?: string
}

/**
 * Trade an IdP-issued subject token for an SP-scoped access token.
 *
 * Posts the IdP's `access_token` to `${endpoint}/api/cli/exchange`. The SP
 * verifies the IdP signature + expected audience (`apes-cli`) via JWKS,
 * applies its own policy checks (member? banned? rate-limited?), and mints
 * an HS256 JWT with `aud=<sp.host>` and a longer expiry.
 *
 * The returned SpToken is also persisted to `~/.config/apes/sp-tokens/<aud>.json`
 * so subsequent `getAuthorizedBearer` calls can hit cache.
 */
export async function exchangeForSpToken(
  idpAuth: IdpAuth,
  request: ExchangeRequest,
  now: number = Math.floor(Date.now() / 1000),
): Promise<SpToken> {
  const url = `${request.endpoint.replace(/\/$/, '')}/api/cli/exchange`

  let response: ExchangeResponse
  try {
    response = await ofetch<ExchangeResponse>(url, {
      method: 'POST',
      body: {
        subject_token: idpAuth.access_token,
        ...(request.scopes ? { scopes: request.scopes } : {}),
      },
    })
  }
  catch (err: unknown) {
    const status = (err as { status?: number, statusCode?: number }).status
      ?? (err as { statusCode?: number }).statusCode
      ?? 0
    const data = (err as { data?: { title?: string, detail?: string } }).data
    const title = data?.title ?? `Token exchange failed (HTTP ${status})`
    const hint = status === 401
      ? `IdP token rejected at ${url}. Try \`apes login\` again — token may be expired or audience-mismatched.`
      : data?.detail
    throw new AuthError(status, title, hint)
  }

  if (!response.access_token) {
    throw new AuthError(0, `Exchange response from ${url} missing access_token`)
  }

  const expiresAt = response.expires_at
    ?? (response.expires_in ? now + response.expires_in : now + 3600 * 24 * 30)

  const token: SpToken = {
    endpoint: request.endpoint,
    aud: response.aud ?? request.aud,
    access_token: response.access_token,
    expires_at: expiresAt,
    ...(request.scopes ? { scopes: request.scopes } : {}),
    issued_from_idp_iat: now,
  }
  saveSpToken(token)
  return token
}
