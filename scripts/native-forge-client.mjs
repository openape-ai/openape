import { repository } from './repository.mjs'

export class ForgeError extends Error {
  constructor(code, message, status = 0) { super(message); this.code = code; this.status = status }
}

export function parseRepository(value = new URL(repository.url).pathname.slice(1).replace(/\.git$/, '')) {
  if (!/^[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*$/i.test(value)) throw new ForgeError('INVALID_REPOSITORY', 'Use --repo owner/name')
  return value
}

export function createClient({ endpoint = new URL(repository.url).origin, authorize, fetcher = fetch } = {}) {
  return async (method, path, body, { idempotencyKey } = {}) => {
    if (!path.startsWith('/api/')) throw new ForgeError('INVALID_PATH', 'API path required')
    let authorization
    try {
      const getToken = authorize ?? (await import('../packages/cli-auth/dist/index.js')).getAuthorizedBearer
      authorization = await getToken({ endpoint, aud: new URL(endpoint).host })
    }
    catch { throw new ForgeError('AUTH_REQUIRED', 'OpenApe authentication unavailable. Run apes login for your identity, then retry.') }
    let response
    try {
      response = await fetcher(`${endpoint}${path}`, { method, headers: { authorization, 'content-type': 'application/json', ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(30_000) })
    }
    catch { throw new ForgeError('NETWORK_ERROR', 'The native forge could not be reached. Check the endpoint and connection.') }
    let data
    try { data = await response.json() }
    catch { throw new ForgeError('INVALID_RESPONSE', `The native forge returned invalid JSON (HTTP ${response.status}).`, response.status) }
    if (!response.ok) {
      const message = data.statusMessage || data.message || data.title || `HTTP ${response.status}`
      const issueRequest = /\/(?:issues|issue-records|reports|labels)(?:\/|\?|$)/.test(path)
      const code = response.status === 429 ? 'RATE_LIMITED' : response.status === 409 && issueRequest ? 'CONFLICT' : response.status === 401 ? 'AUTH_REQUIRED' : response.status === 403 ? 'ACCESS_DENIED' : response.status === 404 ? 'NOT_FOUND' : response.status === 409 ? (/check/i.test(message) ? 'CHECKS_BLOCKED' : 'STALE_REVIEW') : 'REQUEST_FAILED'
      throw new ForgeError(code, message, response.status)
    }
    return data
  }
}
