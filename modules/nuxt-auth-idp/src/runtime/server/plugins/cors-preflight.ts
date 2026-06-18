import type { NitroApp } from 'nitropack'

// Paths CORS applies to (matches existing routeRules patterns).
const CORS_PATHS = /^\/(?:\.well-known\/|token\b|userinfo\b|api\/(?:auth|agent|grants|delegations)\/)/

/**
 * Parse the comma-separated allowlist from env. Empty / unset → empty
 * Set (back-compat: behaves like the legacy `Allow-Origin: *`
 * no-credentials mode). Trims, strips trailing slashes, lowercases.
 *
 * Read once at module-load. Changing the env requires a restart, same
 * as every other env-driven config in the IdP.
 */
function readAllowedOrigins(): Set<string> {
  const raw = process.env.NUXT_OPENAPE_IDP_CORS_ALLOWED_ORIGINS ?? ''
  return new Set(
    raw
      .split(',')
      .map(s => s.trim().replace(/\/$/, '').toLowerCase())
      .filter(Boolean),
  )
}
const ALLOWED_ORIGINS = readAllowedOrigins()

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  return ALLOWED_ORIGINS.has(origin.toLowerCase().replace(/\/$/, ''))
}

/**
 * CORS plugin with two modes:
 *
 *   - **Legacy** (env unset): `Access-Control-Allow-Origin: *` on
 *     preflight only. No credentials. Matches pre-M4 behaviour for
 *     CLI tools that send Bearer Authorization (no cookies needed).
 *
 *   - **Allowlist** (env set): for requests whose `Origin` header is
 *     in `NUXT_OPENAPE_IDP_CORS_ALLOWED_ORIGINS`, echo that origin +
 *     `Allow-Credentials: true` on BOTH preflight AND actual response.
 *     Enables Receiver SPs (e.g. a company SP) to call IdP endpoints
 *     from the Owner's browser using their IdP session cookie (the
 *     sp-data-access.md flow). Requests from non-allowlisted origins
 *     fall back to the legacy wildcard on preflight (and get no CORS
 *     headers on the actual response, so the browser blocks them).
 *
 * The non-OPTIONS branch is new: we have to set CORS headers on the
 * actual response too, otherwise the browser blocks reading the body
 * even though the preflight passed.
 *
 * Pairs with `getAppSession`'s sameSite='none' switch (also keyed on
 * the same env var) — both are required for cross-origin cookie sends.
 */
export default (nitroApp: NitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    const path = event.path || ''
    if (!CORS_PATHS.test(path)) return

    const origin = event.node.req.headers.origin
    const res = event.node.res
    const useAllowlist = isAllowedOrigin(origin)

    if (event.method === 'OPTIONS') {
      if (useAllowlist) {
        res.setHeader('Access-Control-Allow-Origin', origin!)
        res.setHeader('Access-Control-Allow-Credentials', 'true')
        // When echoing a specific origin, Vary tells caches the response
        // depends on Origin so a different origin's preflight doesn't
        // get an incorrect cached response served.
        res.setHeader('Vary', 'Origin')
      }
      else {
        res.setHeader('Access-Control-Allow-Origin', '*')
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      res.setHeader('Access-Control-Max-Age', '86400')
      res.statusCode = 204
      res.end()
      return
    }

    // Non-OPTIONS: tag the actual response with CORS headers so the
    // browser permits the caller to read the body.
    if (useAllowlist) {
      res.setHeader('Access-Control-Allow-Origin', origin!)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      res.setHeader('Vary', 'Origin')
    }
    // No `*` here on the response path: setting Allow-Origin:* on a
    // non-OPTIONS response without an explicit caller request could
    // mask a misconfigured deployment. The legacy `*` wildcard only
    // ever applied to preflight, and we preserve that above.
  })
}
