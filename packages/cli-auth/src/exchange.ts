import { saveSpToken } from './storage.js'
import { AuthError } from './types.js'
import type { IdpAuth, SpToken } from './types.js'

export interface ExchangeRequest {
  /** Endpoint of the SP that owns the exchange (e.g. `https://plans.openape.ai`). */
  endpoint: string
  /** Audience the SP advertises for its exchanged tokens (e.g. `plans.openape.ai`). */
  aud: string
  /** Optional scope hints the SP may use to scope-down the issued token. */
  scopes?: string[]
}

/** A fetch-compatible transport; callers with their own network policy pass it in. */
export type ExchangeTransport = (url: string, init: RequestInit) => Promise<Response>

export interface SpTokenRequestOptions {
  transport?: ExchangeTransport
  signal?: AbortSignal
}

interface ExchangeReply {
  access_token?: unknown
  expires_at?: unknown
  expires_in?: unknown
  aud?: unknown
  title?: unknown
  detail?: unknown
}

/**
 * Trade an IdP-issued subject token for an SP-scoped access token without
 * touching the on-disk token cache.
 *
 * Posts `{ subject_token, scopes? }` to `${endpoint}/api/cli/exchange`. The SP
 * verifies the IdP signature + expected audience (`apes-cli`) via JWKS,
 * applies its own policy checks (member? banned? rate-limited?), and mints
 * an HS256 JWT with `aud=<sp.host>`. Transport failures propagate unchanged;
 * an SP refusal or an incomplete reply throws `AuthError`.
 */
export async function requestSpToken(
  subjectToken: string,
  request: ExchangeRequest,
  options: SpTokenRequestOptions = {},
  now: number = Math.floor(Date.now() / 1000),
): Promise<SpToken> {
  const url = `${request.endpoint.replace(/\/$/, '')}/api/cli/exchange`
  // A followed 307/308 would resend the subject token to the redirect target.
  const transport = options.transport ?? ((target: string, init: RequestInit) => fetch(target, { ...init, redirect: 'error' }))
  const response = await transport(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({ subject_token: subjectToken, ...(request.scopes ? { scopes: request.scopes } : {}) }),
    ...(options.signal ? { signal: options.signal } : {}),
  })
  const reply = await readReply(response)

  if (!response.ok) {
    const title = typeof reply?.title === 'string' ? reply.title : `Token exchange failed (HTTP ${response.status})`
    const hint = response.status === 401
      ? `IdP token rejected at ${url}. Try \`apes login\` again — token may be expired or audience-mismatched.`
      : typeof reply?.detail === 'string' ? reply.detail : undefined
    throw new AuthError(response.status, title, hint)
  }

  if (typeof reply?.access_token !== 'string' || !reply.access_token) {
    throw new AuthError(0, `Exchange response from ${url} missing access_token`)
  }

  // Short fallback when an SP omits both claims (#283 item 3). The old
  // 30-day default cached misbehaving SPs effectively forever; an hour
  // is short enough that revocation upstream catches up while still
  // covering the common case where a server forgets to set the field.
  const expiresAt = typeof reply.expires_at === 'number'
    ? reply.expires_at
    : typeof reply.expires_in === 'number' && reply.expires_in ? now + reply.expires_in : now + 3600

  return {
    endpoint: request.endpoint,
    aud: typeof reply.aud === 'string' ? reply.aud : request.aud,
    access_token: reply.access_token,
    expires_at: expiresAt,
    ...(request.scopes ? { scopes: request.scopes } : {}),
    issued_from_idp_iat: now,
  }
}

async function readReply(response: Response): Promise<ExchangeReply | null> {
  const text = await response.text()
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as ExchangeReply : null
  }
  catch {
    return null
  }
}

/**
 * Trade an IdP-issued subject token for an SP-scoped access token and persist
 * it to `~/.config/apes/sp-tokens/<aud>.json`, so subsequent
 * `getAuthorizedBearer` calls can hit cache.
 */
export async function exchangeForSpToken(
  idpAuth: IdpAuth,
  request: ExchangeRequest,
  now: number = Math.floor(Date.now() / 1000),
): Promise<SpToken> {
  let token: SpToken
  try {
    token = await requestSpToken(idpAuth.access_token, request, {}, now)
  }
  catch (err: unknown) {
    if (err instanceof AuthError) throw err
    throw new AuthError(0, 'Token exchange failed (HTTP 0)')
  }
  saveSpToken(token)
  return token
}
