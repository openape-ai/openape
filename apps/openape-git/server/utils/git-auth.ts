import { createRemoteJWKSet, jwtVerify } from 'jose'
import { useRuntimeConfig } from 'nitropack/runtime'

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null

function idpJwks() {
  if (!_jwks) {
    const config = useRuntimeConfig()
    _jwks = createRemoteJWKSet(new URL('/.well-known/jwks.json', config.idpUrl as string))
  }
  return _jwks
}

/**
 * Authenticate a git smart-HTTP request: HTTP Basic, password field = DDISA
 * JWT (`x-access-token:<JWT>`, the GitHub-Apps pattern — works with every git
 * client and .netrc). Returns the verified identity email, or null.
 */
export async function emailFromBasicAuth(header: string | undefined): Promise<string | null> {
  if (!header?.startsWith('Basic ')) return null
  const decoded = Buffer.from(header.slice(6), 'base64').toString()
  const separator = decoded.indexOf(':')
  if (separator === -1) return null
  const token = decoded.slice(separator + 1)
  if (!token) return null
  try {
    const config = useRuntimeConfig()
    const { payload } = await jwtVerify(token, idpJwks(), {
      issuer: config.idpUrl as string,
      // apes-issued CLI tokens carry aud 'apes-cli'; AuthZ JWTs carry the SP id.
      audience: ['apes-cli', (config.openapeSp as { clientId?: string })?.clientId ?? 'repos.openape.ai'],
    })
    const email = payload.email ?? payload.sub
    return typeof email === 'string' ? email : null
  }
  catch {
    return null
  }
}
