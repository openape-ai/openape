import { ofetch } from 'ofetch'
import { loadIdpAuth, saveIdpAuth } from './storage.js'
import { AuthError, NotLoggedInError  } from './types.js'
import type { IdpAuth } from './types.js'

/**
 * Skew applied when deciding whether a token is expired. We refresh 30 seconds
 * before the actual `exp` so an in-flight request never lands at the SP after
 * the IdP has already rejected the bearer.
 */
const EXPIRY_SKEW_SECONDS = 30

interface DiscoveryDocument {
  token_endpoint?: string
}

async function getTokenEndpoint(idp: string): Promise<string> {
  try {
    const disco = await ofetch<DiscoveryDocument>(`${idp}/.well-known/openid-configuration`)
    if (disco.token_endpoint) return disco.token_endpoint
  }
  catch {
    // Fall through to the conventional path.
  }
  return `${idp}/token`
}

/**
 * Return a non-expired IdP token. If the cached one is still good (with skew),
 * return it as-is. Otherwise try the OAuth refresh-token grant against the
 * IdP's `/token` endpoint. On success, persist the new auth and return it. On
 * failure (no refresh_token, refresh rejected, network error), throw
 * `NotLoggedInError`.
 *
 * NOTE: this function does NOT serialize concurrent calls. Two parallel
 * `apes`/`ape-plans` invocations could both consume the same rotating
 * refresh_token and one would lose. The `@openape/apes` package already
 * implements file-locking around its own refresh; we cooperate with the same
 * `~/.config/apes/auth.json` file but rely on apes to own the lock for now.
 * Cross-package locking is a follow-up — for the MVP single-user case it
 * effectively never races.
 */
export async function ensureFreshIdpAuth(now: number = Math.floor(Date.now() / 1000)): Promise<IdpAuth> {
  const auth = loadIdpAuth()
  if (!auth) {
    throw new NotLoggedInError()
  }

  if (auth.expires_at > now + EXPIRY_SKEW_SECONDS) {
    return auth
  }

  if (!auth.refresh_token) {
    throw new NotLoggedInError(
      `IdP token expired at ${new Date(auth.expires_at * 1000).toISOString()} and no refresh_token is stored. Run \`apes login\` again.`,
    )
  }

  const tokenEndpoint = await getTokenEndpoint(auth.idp)
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: auth.refresh_token,
  })

  let response: { access_token?: string, refresh_token?: string, expires_in?: number }
  try {
    response = await ofetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  }
  catch (err: unknown) {
    const status = (err as { status?: number, statusCode?: number }).status
      ?? (err as { statusCode?: number }).statusCode
      ?? 0
    if (status === 400 || status === 401) {
      // Refresh-token family revoked or already-rotated. Clear it so we don't
      // loop refreshing on every subsequent invocation; user must re-login.
      saveIdpAuth({ ...auth, refresh_token: undefined })
      throw new NotLoggedInError(
        `Refresh token rejected by ${auth.idp}. Run \`apes login\` again.`,
      )
    }
    throw new AuthError(
      0,
      `Network error refreshing IdP token at ${tokenEndpoint}`,
      `Underlying: ${(err as Error).message ?? err}`,
    )
  }

  if (!response.access_token) {
    throw new AuthError(0, `IdP refresh response missing access_token (endpoint: ${tokenEndpoint})`)
  }

  const next: IdpAuth = {
    ...auth,
    access_token: response.access_token,
    refresh_token: response.refresh_token ?? auth.refresh_token,
    expires_at: now + (response.expires_in ?? 3600),
  }
  saveIdpAuth(next)
  return next
}
