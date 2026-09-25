import type { H3Event } from 'h3'
import { createError, getHeader, useSession } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { verifyCliToken } from './cli-token'
import { assertCatalogScopeCoversRequest } from './require-auth'

export interface VerifiedPrincipal {
  subject: string
  actor: string
  act: 'human' | 'agent'
  scope?: string[]
  authentication: 'session' | 'bearer'
}

function principalFromClaims(claims: Record<string, unknown>, authentication: VerifiedPrincipal['authentication']): VerifiedPrincipal {
  const subject = claims.sub ?? claims.email
  const act = claims.act
  const actorClaim = act && typeof act === 'object' ? (act as { sub?: unknown }).sub : undefined
  const delegate = typeof claims.delegate === 'object' && claims.delegate
    ? (claims.delegate as { sub?: unknown }).sub
    : claims.delegate
  const actor = actorClaim ?? delegate ?? subject
  const scope = claims.scope
  if (typeof subject !== 'string' || !subject || typeof actor !== 'string' || !actor
    || (actorClaim && delegate && actorClaim !== delegate)
    || (scope !== undefined && (!Array.isArray(scope) || !scope.every(s => typeof s === 'string')))
    || (actor !== subject && !Array.isArray(scope))) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid or unbounded principal' })
  }
  return { subject, actor, act: actor !== subject || act !== 'human' ? 'agent' : 'human', scope: scope as string[] | undefined, authentication }
}

/** Verified SP sessions/exchanged tokens; raw IdP tokens must use the existing exchange. */
export async function requireScopedPrincipal(event: H3Event, requiredScopes: string[]): Promise<VerifiedPrincipal> {
  const authorization = getHeader(event, 'authorization')
  let principal: VerifiedPrincipal
  if (authorization) {
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
    const claims = token ? await verifyCliToken(token) : null
    if (!claims) throw createError({ statusCode: 401, statusMessage: 'Valid exchanged bearer token required' })
    principal = principalFromClaims({ ...claims }, 'bearer')
  }
  else {
    const password = (useRuntimeConfig().openapeSp as { sessionSecret?: string })?.sessionSecret
    if (!password) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
    let claims: Record<string, unknown> | undefined
    try {
      const session = await useSession<{ claims?: Record<string, unknown> }>(event, { name: 'openape-sp', password })
      claims = session.data?.claims
    }
    catch {
      throw createError({ statusCode: 401, statusMessage: 'Valid session required' })
    }
    if (!claims) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
    principal = principalFromClaims(claims, 'session')
  }
  if (principal.scope !== undefined) assertCatalogScopeCoversRequest(event, principal.scope, requiredScopes)
  return principal
}
