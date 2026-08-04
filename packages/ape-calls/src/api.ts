/** Calls API wrappers around the shared cli-auth HTTP machinery — see client.ts. */
import { _request } from './client.ts'

export async function apiCall<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  opts: { body?: unknown, query?: Record<string, string | number | boolean | undefined>, endpoint?: unknown } = {},
): Promise<T> {
  return _request<T>(path, {
    method,
    body: opts.body,
    query: opts.query as Record<string, string | number | undefined> | undefined,
    endpoint: typeof opts.endpoint === 'string' ? opts.endpoint : undefined,
  })
}
