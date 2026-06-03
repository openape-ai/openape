// Thin wrapper around the authoritative SSRF guard in @openape/core.
// agent-runtime uses http+https mode ({ allowHttp: true }) because agents may
// legitimately reach http-only targets. safeFetch is kept here as it is
// agent-runtime-specific (manual redirect loop with per-hop revalidation).

import { assertPublicUrl } from '@openape/core'

export { assertPublicUrl, isBlockedAddress } from '@openape/core'

/**
 * fetch() with SSRF protection: validates the initial URL and re-validates
 * every redirect hop (redirects are followed manually, capped at maxRedirects).
 */
export async function safeFetch(rawUrl: string, init: RequestInit = {}, maxRedirects = 5): Promise<Response> {
  let current = rawUrl
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await assertPublicUrl(current, { allowHttp: true })
    const res = await fetch(current, { ...init, redirect: 'manual' })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return res
      // Resolve relative redirects against the current URL, then re-validate.
      current = new URL(location, current).toString()
      // A redirect that turns a POST into a GET is standard; the body is not
      // re-sent by fetch on the next manual call, so drop it for safety.
      if (init.body) init = { ...init, body: undefined, method: 'GET' }
      continue
    }
    return res
  }
  throw new Error(`Too many redirects (>${maxRedirects}) for ${rawUrl}`)
}
