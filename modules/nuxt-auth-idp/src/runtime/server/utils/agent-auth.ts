import type { H3Event } from 'h3'
import { getHeader } from 'h3'
import type { AgentTokenPayload, AuthTokenPayload } from './agent-token'
import { verifyAgentToken, verifyAuthToken } from './agent-token'
import { getIdpIssuer, useIdpStores } from './stores'
import { createProblemError } from './problem'

// --- Generalized bearer auth (accepts both agent and human tokens) ---

export async function tryBearerAuth(event: H3Event): Promise<AuthTokenPayload | null> {
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader?.startsWith('Bearer '))
    return null

  const token = authHeader.slice(7)
  const { keyStore } = useIdpStores()
  const signingKey = await keyStore.getSigningKey()

  try {
    return await verifyAuthToken(token, getIdpIssuer(), signingKey.publicKey)
  }
  catch (err) {
    console.warn('[openape-idp] Bearer token verification failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}

// --- Agent-specific (backward compatibility) ---

export async function requireAgent(event: H3Event): Promise<AgentTokenPayload> {
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw createProblemError({ status: 401, title: 'Bearer token required' })
  }

  const token = authHeader.slice(7)
  const { keyStore } = useIdpStores()
  const signingKey = await keyStore.getSigningKey()

  try {
    return await verifyAgentToken(token, getIdpIssuer(), signingKey.publicKey)
  }
  catch {
    throw createProblemError({ status: 401, title: 'Invalid or expired agent token' })
  }
}

export async function tryAgentAuth(event: H3Event): Promise<AgentTokenPayload | null> {
  const result = await tryBearerAuth(event)
  if (!result || result.act !== 'agent') return null
  return result as AgentTokenPayload
}
