import { ApiError } from '@openape/cli-auth'
import { _request } from './client.ts'

export { ApiError }

/**
 * Ruft die crm.openape.ai-API mit Bearer-Auth auf. Die Anmeldung kommt aus
 * `apes login` — @openape/cli-auth tauscht den IdP-Token gegen einen
 * SP-Token und cached ihn.
 */
export async function apiCall<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  opts: {
    body?: unknown
    query?: Record<string, string | number | undefined>
    endpoint?: unknown
  } = {},
): Promise<T> {
  return _request<T>(path, {
    method,
    body: opts.body,
    query: opts.query,
    endpoint: typeof opts.endpoint === 'string' ? opts.endpoint : undefined,
  })
}
