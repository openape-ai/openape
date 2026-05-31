import type { H3Event } from 'h3'
import { createRemoteJWKS, verifyJWT } from '@openape/core'

// Same auth pattern as troop:
//   * requireOwner — UI session cookie OR human Bearer (act='human',
//     aud='apes-cli') for CLI/agent-on-behalf flows
//   * requireAgent — agent JWT (act='agent'), used in M1+ when the
//     CEO/Sanierer write back to their org
//
// Owner-routes mutate org/objectives/reports. Agent-routes (later)
// are scoped to their own org via membership lookup.

interface DDISAClaims {
  sub?: string
  act?: 'human' | 'agent' | string
  aud?: string | string[]
}

const CLI_AUDIENCE = 'apes-cli'

let _jwksCache: ReturnType<typeof createRemoteJWKS> | null = null

function getJwks() {
  if (!_jwksCache) {
    const idpUrl = useRuntimeConfig().public.idpUrl as string
    const url = new URL('/.well-known/jwks.json', idpUrl).toString()
    _jwksCache = createRemoteJWKS(url)
  }
  return _jwksCache
}

function problem(status: number, title: string): never {
  throw createError({ statusCode: status, statusMessage: title, data: { type: 'about:blank', status, title } })
}

export async function requireOwner(event: H3Event): Promise<string> {
  const session = await getSpSession(event)
  const sessionEmail = (session.data as { claims?: DDISAClaims })?.claims?.sub
  if (sessionEmail) return sessionEmail

  const auth = getHeader(event, 'Authorization')
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim()
    const idpUrl = useRuntimeConfig().public.idpUrl as string
    try {
      const result = await verifyJWT(token, getJwks(), { issuer: idpUrl })
      const claims = result.payload as DDISAClaims
      const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
      if (claims.act === 'human' && auds.includes(CLI_AUDIENCE) && typeof claims.sub === 'string') {
        return claims.sub
      }
    }
    catch { /* fall through */ }
  }
  problem(401, 'Authentication required')
}

export async function requireAgent(event: H3Event): Promise<string> {
  const auth = getHeader(event, 'Authorization')
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
    problem(401, 'Bearer agent JWT required')
  }
  const token = auth.slice(7).trim()
  const idpUrl = useRuntimeConfig().public.idpUrl as string
  let claims: DDISAClaims
  try {
    const result = await verifyJWT(token, getJwks(), { issuer: idpUrl })
    claims = result.payload as DDISAClaims
  }
  catch {
    problem(401, 'Invalid or expired agent JWT')
  }
  if (claims.act !== 'agent') problem(403, 'agent JWT required (act != "agent")')
  if (typeof claims.sub !== 'string') problem(401, 'agent JWT has no sub claim')
  return claims.sub
}
