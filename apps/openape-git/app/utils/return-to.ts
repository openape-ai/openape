const STORAGE_KEY = 'ape-git:returnTo'

// `//evil.example` and `/\evil.example` both start with a slash but navigate
// off-site — the browser reads the second character as part of the authority.
// Requiring a single slash followed by a non-slash keeps the value in-app.
export function safeReturnPath(value: string | null): string | null {
  if (!value || !/^\/[^/\\]/.test(value)) return null
  return value
}

export function rememberReturnPath(path: string): void {
  window.sessionStorage.setItem(STORAGE_KEY, path)
}

/** Reads the remembered path and clears it, so a stale target cannot fire twice. */
export function takeReturnPath(): string | null {
  const stored = window.sessionStorage.getItem(STORAGE_KEY)
  window.sessionStorage.removeItem(STORAGE_KEY)
  return safeReturnPath(stored)
}
