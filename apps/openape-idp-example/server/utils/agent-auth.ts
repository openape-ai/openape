import type { H3Event } from 'h3'
import { verifyAgentToken, type AgentTokenPayload } from './agent-token'

export async function requireAgent(event: H3Event): Promise<AgentTokenPayload> {
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw createError({ statusCode: 401, statusMessage: 'Bearer token required' })
  }

  const token = authHeader.slice(7)
  const { keyStore } = useStores()
  const signingKey = await keyStore.getSigningKey()

  try {
    return await verifyAgentToken(token, IDP_ISSUER, signingKey.publicKey)
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Invalid or expired agent token' })
  }
}

/**
 * Try to extract agent payload from Bearer token.
 * Returns null if no token or invalid token (non-throwing).
 */
export async function tryAgentAuth(event: H3Event): Promise<AgentTokenPayload | null> {
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)
  const { keyStore } = useStores()
  const signingKey = await keyStore.getSigningKey()

  try {
    return await verifyAgentToken(token, IDP_ISSUER, signingKey.publicKey)
  } catch {
    return null
  }
}
