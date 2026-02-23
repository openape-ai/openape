import { verifyJWT, createRemoteJWKS } from '@openape/core'

export interface AgentIdentity {
  email: string
  act: 'agent'
}

/**
 * Verify agent JWT from Proxy-Authorization header.
 * Returns the agent identity or null if invalid.
 */
export async function verifyAgentAuth(
  authHeader: string | null,
  idpUrl: string,
): Promise<AgentIdentity | null> {
  if (!authHeader) return null

  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) return null

  const token = match[1]

  try {
    const jwks = createRemoteJWKS(`${idpUrl}/.well-known/jwks.json`)
    const { payload } = await verifyJWT(token, jwks, { issuer: idpUrl })

    if (payload.act !== 'agent' || !payload.sub) {
      return null
    }

    return {
      email: payload.sub as string,
      act: 'agent',
    }
  } catch {
    return null
  }
}
