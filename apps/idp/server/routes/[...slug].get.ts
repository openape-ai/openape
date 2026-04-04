import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let cachedHtml: string | null = null

/**
 * SPA fallback: serve index.html for browser navigation requests.
 *
 * The @openape/server handlers (mounted in 01.mount-idp.ts) handle
 * API routes, OIDC endpoints, and .well-known paths. This catch-all
 * only fires for unmatched GET requests with Accept: text/html —
 * i.e. browser navigations to SPA routes like /login, /grant-approval, /enroll.
 */
export default defineEventHandler((event) => {
  const accept = getRequestHeader(event, 'accept') || ''
  if (!accept.includes('text/html')) {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  // Serve the SPA index.html (built by Vite into public/)
  if (!cachedHtml) {
    try {
      cachedHtml = readFileSync(join('public', 'index.html'), 'utf-8')
    }
    catch {
      return 'IdP running. Build the SPA with: pnpm run build:app'
    }
  }

  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  return cachedHtml
})
