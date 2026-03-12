import { verifyJWT, createRemoteJWKS } from '@openape/core'

export interface AgentIdentity {
  email: string
  act: 'agent'
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

/**
 * Verify agent JWT from Proxy-Authorization header.
 * Returns the agent identity or null if invalid/missing.
 * When mandatory is true, throws AuthError if no valid JWT is provided.
 */
export async function verifyAgentAuth(
  authHeader: string | null,
  idpUrl: string,
  mandatory: boolean = false,
): Promise<AgentIdentity | null> {
  if (!authHeader) {
    if (mandatory) throw new AuthError('JWT required')
    return null
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    if (mandatory) throw new AuthError('Invalid authorization header')
    return null
  }

  const token = match[1]

  try {
    const jwks = createRemoteJWKS(`${idpUrl}/.well-known/jwks.json`)
    const { payload } = await verifyJWT(token, jwks, { issuer: idpUrl })

    if (payload.act !== 'agent' || !payload.sub) {
      if (mandatory) throw new AuthError('Invalid agent token')
      return null
    }

    return {
      email: payload.sub as string,
      act: 'agent',
    }
  }
  catch (err) {
    if (err instanceof AuthError) throw err
    if (mandatory) throw new AuthError('JWT verification failed')
    return null
  }
}
