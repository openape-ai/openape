/**
 * Tasks-app API wrappers.
 *
 * The HTTP machinery (auth, retry, error mapping) now lives in
 * @openape/cli-auth via createSpClient (see src/client.ts). This file
 * exposes the same public surface that command files import, so no
 * command file needs to change.
 */
import { ApiError } from '@openape/cli-auth'
import { _request } from './client.ts'

export { ApiError }

export function createApiError(status: number, title: string, detail?: string): ApiError {
  return new ApiError(status, title, detail)
}

/**
 * Call the tasks.openape.ai API with bearer auth. Signature mirrors the
 * original so all existing command call-sites (`apiCall('GET', path, opts)`)
 * keep working unchanged.
 *
 * Auth is delegated to @openape/cli-auth.getAuthorizedBearer, which:
 *   1. Returns a cached SP-token if still valid
 *   2. Otherwise refreshes the IdP token and exchanges it via ${endpoint}/api/cli/exchange
 *
 * The user must have run `apes login` once on this device.
 */
export async function apiCall<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  opts: {
    body?: unknown
    query?: Record<string, string | number | boolean | undefined>
    endpoint?: unknown
    auth?: boolean
  } = {},
): Promise<T> {
  return _request<T>(path, {
    method,
    body: opts.body,
    query: opts.query as Record<string, string | number | undefined> | undefined,
    endpoint: typeof opts.endpoint === 'string' ? opts.endpoint : undefined,
  })
}
