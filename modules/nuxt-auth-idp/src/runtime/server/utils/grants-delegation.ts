import type { H3Event } from 'h3'
import type { BrokeredGrant, GrantsDelegationScope, OpenApeGrant, OpenApeGrantRequest } from '@openape/core'
import { GRANTS_DELEGATION_SCOPES } from '@openape/core'
import { introspectGrant } from '@openape/grants'
import { getHeader } from 'h3'
import { verifyAuthToken } from './agent-token'
import { parseBrokerGrantRequest } from './broker-grant-request'
import { brokerInput } from './broker-input'
import { hasBrokerStore, useBrokerStore } from './broker-store'
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
 * The broker binding of a brokered identity (for example a Pod identity of an
 * agent provider) that belongs to `owner`: taken from the identity's newest
 * brokered grant here whose broker connection is still active and owned by
 * `owner`. Null when this IdP does not know the identity as the owner's.
 */
async function ownedBrokeredIdentity(event: H3Event, requester: string, owner: string): Promise<BrokeredGrant | null> {
  if (!hasBrokerStore()) return null
  const grants = await useGrantStores().grantStore.findByRequester(requester)
  const newest = grants.filter(grant => grant.brokered?.owner === owner).sort((a, b) => b.created_at - a.created_at)[0]?.brokered
  if (!newest) return null
  const connection = await useBrokerStore(event).getConnection(newest.connection_id)
  const domain = requester.split('@')[1]
  if (connection?.status !== 'active' || connection.owner.subject !== owner || connection.broker_issuer !== newest.broker_issuer || connection.agent_domain !== domain) return null
  return newest
}

/**
 * A delegate may only ask for one of its delegator's own active agents, or
 * for a brokered identity of the delegator, and never for a delegation (no
 * chaining, delegation.md §7.3). A brokered identity's request keeps its
 * broker binding and the checks of a brokered request.
 */
export async function assertDelegatedRequest(event: H3Event, request: OpenApeGrantRequest, delegate: GrantsDelegate): Promise<{ brokered?: BrokeredGrant }> {
  if (request.delegator !== undefined || request.delegate !== undefined || request.scopes !== undefined) {
    throw createProblemError({ status: 400, title: 'A delegate cannot request a delegation' })
  }
  const refused = () => createProblemError({ status: 403, title: 'A delegate can only request grants for its delegator\'s own agents' })
  if (typeof request.requester !== 'string') throw refused()
  const requester = await useIdpStores().userStore.findByEmail(request.requester)
  if (requester) {
    if (!requester.isActive || requester.owner !== delegate.delegator) throw refused()
    return {}
  }
  const brokered = await ownedBrokeredIdentity(event, request.requester, delegate.delegator)
  if (!brokered) throw refused()
  await brokerInput(() => parseBrokerGrantRequest(request, request.requester))
  return { brokered }
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
