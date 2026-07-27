/**
 * Where an SP sends the user after a successful login when it does not pin
 * `openapeSp.postLoginRedirect`.
 *
 * Must be a route every SP is guaranteed to have: `/` always exists, a bare SP
 * has no `/dashboard`. Apps with a different post-login landing page set the
 * option explicitly in their nuxt.config.
 *
 * Single source of truth for this default — module defaults, the runtime
 * resolver, the OIDC callback fallback, and `OpenApeAuth.vue` all import it, so
 * the value can never drift out of agreement again.
 */
export const DEFAULT_POST_LOGIN_REDIRECT = '/'
