/** Minimal H3Event stand-in for the `/api/admin/*` handlers. */
export interface AdminEventOptions {
  /** Raw Authorization header value, e.g. `Bearer <token>`. */
  auth?: string
  params?: Record<string, string>
  query?: Record<string, unknown>
  body?: unknown
  context?: Record<string, unknown>
}

export function adminEvent(options: AdminEventOptions = {}): any {
  return {
    headers: options.auth ? { authorization: options.auth } : {},
    params: options.params ?? {},
    query: options.query ?? {},
    body: options.body,
    context: options.context ?? {},
  }
}
