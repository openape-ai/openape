export function issueError(error: unknown): string {
  const response = error as { statusCode?: number, data?: { statusCode?: number, statusMessage?: string } }
  const status = response.statusCode ?? response.data?.statusCode
  if (status === 409) return 'This record changed. Your draft is kept. Reload the current version before trying again.'
  if (status === 401) return 'Your session expired. Sign in again to continue.'
  if (status === 403 || status === 404) return 'This item is unavailable or your access has changed.'
  return response.data?.statusMessage ?? 'The request failed. Your draft is kept; please retry.'
}
export function issueDate(time: number) { return new Date(time).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' }) }
