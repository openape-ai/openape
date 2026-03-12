/**
 * Generate a cryptographically random PKCE code verifier.
 */
export function generateCodeVerifier(length = 64): string {
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return base64UrlEncode(array)
}

/**
 * Generate the S256 code challenge from a verifier.
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(digest))
}

/**
 * Generate a random state parameter for CSRF protection.
 */
export function generateState(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return base64UrlEncode(array)
}

/**
 * Generate a random nonce.
 */
export function generateNonce(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return base64UrlEncode(array)
}

function base64UrlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data))
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
