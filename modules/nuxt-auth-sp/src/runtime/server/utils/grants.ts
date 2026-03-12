import type { DelegationActClaim, OpenApeAuthorizationDetail } from '@openape/core'
import type { H3Event } from 'h3'
import { getSpSession } from './sp-session'
import { getSpConfig } from './sp-config'

/**
 * Check if the current session has a grant for the given action.
 */
export async function hasGrant(event: H3Event, action: string): Promise<boolean> {
  const session = await getSpSession(event)
  const details = session.data.authorizationDetails as OpenApeAuthorizationDetail[] | undefined
  if (!details) return false
  return details.some(d => d.action === action)
}

/**
 * Find a specific grant by action from the session's authorization_details.
 */
export async function findGrant(event: H3Event, action: string): Promise<OpenApeAuthorizationDetail | null> {
  const session = await getSpSession(event)
  const details = session.data.authorizationDetails as OpenApeAuthorizationDetail[] | undefined
  if (!details) return null
  return details.find(d => d.action === action) ?? null
}

/**
 * Consume a 'once' grant by calling the IdP verify endpoint.
 * Returns the verification result or throws on failure.
 */
export async function consumeGrant(event: H3Event, grantId: string): Promise<{ valid: boolean }> {
  const session = await getSpSession(event)
  const details = session.data.authorizationDetails as OpenApeAuthorizationDetail[] | undefined

  const detail = details?.find(d => d.grant_id === grantId)
  if (!detail) {
    throw new Error(`Grant ${grantId} not found in session`)
  }

  const claims = session.data.claims as { iss?: string } | undefined
  const idpUrl = claims?.iss || getSpConfig().fallbackIdpUrl

  const response = await fetch(`${idpUrl}/api/grants/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_id: grantId }),
  })

  if (!response.ok) {
    throw new Error(`Grant verification failed: ${response.status}`)
  }

  return response.json() as Promise<{ valid: boolean }>
}

/**
 * Check if the current session is a delegated session (has act claim as object).
 */
export async function isDelegated(event: H3Event): Promise<boolean> {
  const session = await getSpSession(event)
  const claims = session.data.claims as Record<string, unknown> | undefined
  if (!claims) return false
  return typeof claims.act === 'object' && claims.act !== null && 'sub' in (claims.act as Record<string, unknown>)
}

/**
 * Get the actual actor (delegate) from a delegated session.
 * Returns the delegate's identifier (e.g. agent email) or null if not delegated.
 */
export async function getActor(event: H3Event): Promise<string | null> {
  const session = await getSpSession(event)
  const claims = session.data.claims as Record<string, unknown> | undefined
  if (!claims) return null
  const act = claims.act as DelegationActClaim | string | undefined
  if (typeof act === 'object' && act !== null && 'sub' in act) {
    return act.sub
  }
  return null
}

/**
 * Get the subject (delegator — person being acted on behalf of) from the session.
 */
export async function getSubject(event: H3Event): Promise<string | null> {
  const session = await getSpSession(event)
  const claims = session.data.claims as Record<string, unknown> | undefined
  if (!claims) return null
  return (claims.sub as string) ?? null
}
