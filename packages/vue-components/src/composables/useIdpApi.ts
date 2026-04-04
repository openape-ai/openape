/**
 * Simple fetch wrapper for OpenApe IdP endpoints.
 * All requests include credentials (cookies) for session-based auth.
 */
export function useIdpApi(baseUrl: string = '') {
  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, { credentials: 'include' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as Record<string, string>).title || `${res.status}`)
    }
    return res.json() as Promise<T>
  }

  async function post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as Record<string, string>).title || `${res.status}`)
    }
    return res.json() as Promise<T>
  }

  return { get, post }
}
