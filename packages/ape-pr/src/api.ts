/**
 * PR API wrappers around the shared @openape/cli-auth HTTP machinery
 * (auth, retry, error mapping) — see src/client.ts.
 */
import { _request } from './client.ts'

export async function apiCall<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  opts: {
    body?: unknown
    query?: Record<string, string | number | boolean | undefined>
    endpoint?: unknown
  } = {},
): Promise<T> {
  return _request<T>(path, {
    // @openape/cli-auth's RequestOptions union lacks PUT; ofetch passes any
    // method string through at runtime, so widen via cast until cli-auth
    // adds it upstream.
    method: method as 'GET' | 'POST' | 'PATCH' | 'DELETE',
    body: opts.body,
    query: opts.query as Record<string, string | number | undefined> | undefined,
    endpoint: typeof opts.endpoint === 'string' ? opts.endpoint : undefined,
  })
}
