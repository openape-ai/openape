import { exchangeForSpToken } from './exchange.js'
import { ensureFreshIdpAuth } from './refresh.js'
import { loadSpToken } from './storage.js'

const SP_TOKEN_SKEW_SECONDS = 60

export interface AuthorizedBearerOptions {
  /** SP endpoint (e.g. `https://plans.openape.ai`). */
  endpoint: string
  /** SP audience (e.g. `plans.openape.ai`). */
  aud: string
  /** Optional scopes to request from the SP exchange endpoint. */
  scopes?: string[]
  /** When true, ignore the cached SP-token and force a fresh exchange. */
  forceRefresh?: boolean
}

/**
 * One-shot helper for CLI commands. Returns an `Authorization: Bearer …`
 * header value valid for the given SP, doing whatever is necessary under the
 * hood:
 *
 * 1. Read the cached SP-token. If still valid (with 60 s skew), return it.
 * 2. Otherwise, ensure the IdP-token is fresh (refresh via OIDC if expired).
 * 3. Exchange the IdP-token at the SP's `/api/cli/exchange` endpoint.
 * 4. Persist the resulting SP-token and return it.
 *
 * Throws `NotLoggedInError` if the user is not logged in via `apes login`.
 * Throws `AuthError` if the exchange fails.
 */
export async function getAuthorizedBearer(opts: AuthorizedBearerOptions): Promise<string> {
  const now = Math.floor(Date.now() / 1000)

  if (!opts.forceRefresh) {
    const cached = loadSpToken(opts.aud)
    if (cached && cached.expires_at > now + SP_TOKEN_SKEW_SECONDS) {
      return `Bearer ${cached.access_token}`
    }
  }

  const idpAuth = await ensureFreshIdpAuth(now)
  const sp = await exchangeForSpToken(idpAuth, {
    endpoint: opts.endpoint,
    aud: opts.aud,
    ...(opts.scopes ? { scopes: opts.scopes } : {}),
  }, now)
  return `Bearer ${sp.access_token}`
}
