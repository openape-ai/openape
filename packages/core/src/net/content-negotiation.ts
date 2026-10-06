export type RequestHeaders = Record<string, string | string[] | undefined>

function headerValue(headers: RequestHeaders, name: string): string {
  const raw = headers[name]
  return String(Array.isArray(raw) ? raw[0] ?? '' : raw ?? '')
}

// Highest q-value a media type is listed with in an Accept header,
// or -1 when it is not listed at all. Only exact matches count — a
// browser's `*/*;q=0.8` must not make JSON look "preferred".
function acceptQuality(accept: string, mediaType: string): number {
  let best = -1
  for (const part of accept.split(',')) {
    const [type, ...params] = part.trim().split(';')
    if (type?.trim().toLowerCase() !== mediaType)
      continue
    let quality = 1
    for (const param of params) {
      const [key, value] = param.trim().split('=')
      if (key?.trim().toLowerCase() === 'q') {
        const parsed = Number(value)
        if (Number.isFinite(parsed))
          quality = parsed
      }
    }
    best = Math.max(best, quality)
  }
  return best
}

/**
 * Decide whether an error response should be a human-readable HTML page
 * instead of application/problem+json. Only real browser navigations
 * qualify: the client must accept text/html, must not be an XHR, must
 * not be a fetch/cors request, and must not prefer JSON over HTML.
 */
export function wantsHtmlErrorPage(headers: RequestHeaders): boolean {
  const accept = headerValue(headers, 'accept').toLowerCase()
  const htmlQuality = acceptQuality(accept, 'text/html')
  if (htmlQuality < 0)
    return false
  if (headerValue(headers, 'x-requested-with').toLowerCase() === 'xmlhttprequest')
    return false
  // Browsers send `Sec-Fetch-Mode: navigate` for page navigations;
  // anything else (cors, no-cors, same-origin) is programmatic.
  const fetchMode = headerValue(headers, 'sec-fetch-mode').toLowerCase()
  if (fetchMode && fetchMode !== 'navigate')
    return false
  return acceptQuality(accept, 'application/json') <= htmlQuality
}
