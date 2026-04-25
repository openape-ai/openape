/**
 * Shared client-side auth library for OpenApe CLIs.
 *
 * Public surface:
 *
 * - `getAuthorizedBearer({ endpoint, aud, scopes? })` — one-shot helper that
 *   returns a valid `Bearer …` header for the given SP, handling IdP-token
 *   refresh + SP-token exchange + caching transparently.
 * - `ensureFreshIdpAuth()` — refresh the IdP-issued OAuth token if needed.
 * - `exchangeForSpToken(idpAuth, request)` — manual SP-token mint.
 * - `loadIdpAuth()` / `saveIdpAuth()` / `clearIdpAuth()` — IdP token store.
 * - `loadSpToken(aud)` / `saveSpToken(token)` / `clearSpToken(aud)` /
 *   `clearAllSpTokens()` — SP token cache.
 * - Error types: `AuthError`, `NotLoggedInError`.
 *
 * The IdP token file is shared with `@openape/apes` (both packages read/write
 * `~/.config/apes/auth.json`). SP tokens live in `~/.config/apes/sp-tokens/`.
 */

export { getAuthorizedBearer, type AuthorizedBearerOptions } from './bearer.js'
export { exchangeForSpToken, type ExchangeRequest } from './exchange.js'
export { ensureFreshIdpAuth } from './refresh.js'
export {
  clearAllSpTokens,
  clearIdpAuth,
  clearSpToken,
  getAuthFile,
  getConfigDir,
  getSpTokensDir,
  loadIdpAuth,
  loadSpToken,
  saveIdpAuth,
  saveSpToken,
} from './storage.js'
export { AuthError, NotLoggedInError, type IdpAuth, type SpToken } from './types.js'
