import type { GitIdentity } from './git-identity'
import { assertPublicUrl, extractDomain, resolveIdP } from '@openape/core'
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose'
import { useRuntimeConfig } from 'nitropack/runtime'
import { identityFromClaims } from './git-identity'

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null
let _jwksIssuer = ''

async function idpJwks(issuer: string) {
  if (process.env.OPENAPE_SP_ALLOW_INSECURE_IDP !== '1') await assertPublicUrl(issuer)
  if (!_jwks || _jwksIssuer !== issuer) {
    _jwks = createRemoteJWKSet(new URL('/.well-known/jwks.json', issuer), { timeoutDuration: 5000 })
    _jwksIssuer = issuer
  }
  return _jwks
}

/**
 * Authenticate a git smart-HTTP request: HTTP Basic, password field = DDISA
 * JWT (`x-access-token:<JWT>`, the GitHub-Apps pattern — works with every git
 * client and .netrc). Returns the verified identity, or null.
 */
export async function identityFromBasicAuth(header: string | undefined): Promise<GitIdentity | null> {
  if (!header?.startsWith('Basic ')) return null
  const decoded = Buffer.from(header.slice(6), 'base64').toString()
  const separator = decoded.indexOf(':')
  if (separator === -1) return null
  const token = decoded.slice(separator + 1)
  if (!token) return null
  try {
    const config = useRuntimeConfig()
    const subject = decodeJwt(token).sub
    if (typeof subject !== 'string' || !subject.includes('@')) return null
    const configuredIssuer = (config.idpUrl as string).replace(/\/$/, '')
    const issuer = (await resolveIdP(extractDomain(subject)) ?? configuredIssuer).replace(/\/$/, '')
    const { payload } = await jwtVerify(token, await idpJwks(issuer), {
      issuer,
      // apes-issued CLI tokens carry aud 'apes-cli'; AuthZ JWTs carry the SP id.
      audience: ['apes-cli', (config.openapeSp as { clientId?: string })?.clientId ?? 'repos.openape.ai'],
    })
    if (payload.email !== undefined && payload.email !== subject) return null
    const identity = identityFromClaims(payload)
    // External IdPs authenticate their own direct subjects; the configured IdP retains its existing delegation trust.
    if (issuer !== configuredIssuer && identity?.email !== subject) return null
    return identity
  }
  catch {
    return null
  }
}
