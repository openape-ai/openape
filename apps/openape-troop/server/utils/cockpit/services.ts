// Validate + normalize a service base URL. https-only is the trust boundary:
// the reactive loop will send owner-scoped tasks here, so no plaintext targets.
export function normalizeServiceUrl(input: string): { baseUrl: string, host: string } {
  let url: URL
  try { url = new URL(input) }
  catch { throw createError({ statusCode: 400, statusMessage: 'invalid baseUrl' }) }
  if (url.protocol !== 'https:')
    throw createError({ statusCode: 400, statusMessage: 'baseUrl must be https' })
  return { baseUrl: `${url.protocol}//${url.host}`, host: url.host }
}
