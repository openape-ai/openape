import type { H3Event } from 'h3'
import type { GrantsDelegationScope, OpenApeGrant, OpenApeGrantRequest } from '@openape/core'
import { GRANTS_DELEGATION_SCOPES } from '@openape/core'
import { introspectGrant } from '@openape/grants'
import { getHeader } from 'h3'
import { verifyAuthToken } from './agent-token'
import { useGrantStores } from './grant-stores'
import { createProblemError } from './problem'
import { getIdpIssuer, useIdpStores } from './stores'

/**
 * A delegate acting at the IdP's own grants API for the user who delegated
 * to it (delegation.md §8).
 */
export interface GrantsDelegate {
  /** The user the delegate acts for. */
  delegator: string
  /** The delegate identity, one of the delegator's agents. */
  delegate: string
  /** The delegation grant that authorizes the delegate. */
  delegationGrant: string
}

const GRANTS_SCOPE_PREFIX = 'grants:'

function isGrantsDelegationScope(scope: string): scope is GrantsDelegationScope {
  return (GRANTS_DELEGATION_SCOPES as readonly string[]).includes(scope)
}

/**
 * Why a delegation with these fields cannot carry grants scopes, or null
 * when it can (or carries none). Grants scopes need the IdP itself as the
 * audience and one of the delegator's own active agents as the delegate.
 * Any other `grants:` scope is refused because no decision is delegable.
 */
export async function grantsDelegationProblem(input: {
  delegator: string
  delegate: string
  audience: string
  scopes?: string[]
}): Promise<string | null> {
  const grantsScopes = (input.scopes ?? []).filter(scope => scope.startsWith(GRANTS_SCOPE_PREFIX))
  if (grantsScopes.length === 0) return null
  const unknown = grantsScopes.find(scope => !isGrantsDelegationScope(scope))
  if (unknown) return `Unknown grants scope ${unknown}: only ${GRANTS_DELEGATION_SCOPES.join(' and ')} can be delegated`
  if (input.audience !== getIdpIssuer()) return 'Grants scopes require the IdP issuer as the delegation audience'
  const delegate = await useIdpStores().userStore.findByEmail(input.delegate)
  if (!delegate?.isActive || delegate.owner !== input.delegator) return 'Grants scopes can only be delegated to one of your own active agents'
  return null
}

function bearerToken(event: H3Event): string | null {
  const header = getHeader(event, 'authorization')
  return header?.startsWith('Bearer ') ? header.slice(7) : null
}

async function delegationProblem(grant: OpenApeGrant | null, caller: { delegator: string, delegate: string }, scope: GrantsDelegationScope): Promise<string | null> {
  if (!grant || grant.type !== 'delegation' || grant.status !== 'approved') return 'The delegation is not active'
  const { delegator, delegate, audience, scopes } = grant.request
  if (delegator !== caller.delegator || delegate !== caller.delegate) return 'The token does not match its delegation'
  if (!scopes?.includes(scope)) return `The delegation does not include ${scope}`
  return grantsDelegationProblem({ delegator: caller.delegator, delegate: caller.delegate, audience: audience ?? '', scopes })
}

/**
 * A delegate may only ask for one of its delegator's own active agents and
 * never for a delegation (no chaining, delegation.md §7.3).
 */
export async function assertDelegatedRequest(request: OpenApeGrantRequest, delegate: GrantsDelegate): Promise<void> {
  if (request.delegator !== undefined || request.delegate !== undefined || request.scopes !== undefined) {
    throw createProblemError({ status: 400, title: 'A delegate cannot request a delegation' })
  }
  const requester = typeof request.requester === 'string' ? await useIdpStores().userStore.findByEmail(request.requester) : null
  if (!requester?.isActive || requester.owner !== delegate.delegator) {
    throw createProblemError({ status: 403, title: 'A delegate can only request grants for its delegator\'s own agents' })
  }
}

/**
 * Authenticates a delegated token issued for the IdP itself (`aud` = the
 * issuer, minted by `POST /token` with a `delegation_grant`). Returns null
 * when the request carries no such token, so the endpoint continues with its
 * usual authentication. Throws 403 when it does carry one whose delegation
 * is inactive or lacks `scope` — the delegation is re-read on every call, so
 * a revoked delegation stops working before its tokens expire.
 */
export async function tryGrantsDelegate(event: H3Event, scope: GrantsDelegationScope): Promise<GrantsDelegate | null> {
  const token = bearerToken(event)
  if (!token) return null
  const issuer = getIdpIssuer()
  const signingKey = await useIdpStores().keyStore.getSigningKey()
  const payload = await verifyAuthToken(token, issuer, signingKey.publicKey, issuer).catch(() => null)
  if (!payload || typeof payload.act !== 'object' || !payload.delegation_grant) return null

  const caller = { delegator: payload.sub, delegate: payload.act.sub }
  const grant = await introspectGrant(payload.delegation_grant, useGrantStores().grantStore)
  const problem = await delegationProblem(grant, caller, scope)
  if (problem) throw createProblemError({ status: 403, title: problem })
  return { ...caller, delegationGrant: payload.delegation_grant }
}
