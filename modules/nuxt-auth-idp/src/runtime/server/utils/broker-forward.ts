import type { BrokerRequest } from '@openape/core'
import type { H3Event } from 'h3'
import type { BrokerAgentBinding } from './broker-store'
import { BROKER_REQUEST_TYPE, BROKER_REQUESTER_NAME_CAPABILITY, brokerRequesterName, parseBrokerRequesterName, signBrokerToken } from '@openape/grants'
import { tryBearerAuth } from './agent-auth'
import { brokerEndpoint, brokerFetch, discoverBroker } from './broker-network'
import { hasBrokerStore, useBrokerStore } from './broker-store'
import { createProblemError, relayRetryAfter } from './problem'
import { getIdpIssuer, useIdpStores } from './stores'

export type BrokerOperation = 'connection' | 'create' | 'authorize' | 'get' | 'token'

function brokerClaims(operation: BrokerOperation, common: Record<string, unknown>, identity: Record<string, unknown>, input: unknown): Record<string, unknown> {
  if (operation === 'connection') return { ...common, operation }
  if (operation === 'create' || operation === 'authorize') return { ...common, ...identity, operation, request: input }
  if (operation === 'get' && input && typeof input === 'object') return { ...common, ...identity, operation, reference: (input as { reference: string }).reference }
  return { ...common, ...identity, operation, grant_id: input }
}

export async function forwardBrokerOperation(binding: BrokerAgentBinding, operation: BrokerOperation, input?: unknown, requesterName?: string): Promise<unknown> {
  const discovery = await discoverBroker(binding.decision_issuer, binding.owner.split('@')[1] ?? '')
  const hasReference = input && typeof input === 'object' && 'reference' in input
  if (hasReference && discovery.openape_grant_reference_supported !== true) throw createProblemError({ status: 501, title: 'The decision provider does not support grant references' })
  const key = await useIdpStores().keyStore.getSigningKey()
  const now = Math.floor(Date.now() / 1000)
  const common = { iss: getIdpIssuer(), aud: binding.decision_issuer, iat: now, exp: now + 60, jti: crypto.randomUUID(), connection_id: binding.connection_id, owner: binding.owner }
  const identity = { sub: binding.subject, key_id: binding.key_id, ...(requesterName !== undefined && discovery[BROKER_REQUESTER_NAME_CAPABILITY] === true ? { requester_name: parseBrokerRequesterName(requesterName) } : {}) }
  const assertion = await signBrokerToken(brokerClaims(operation, common, identity, input) as unknown as BrokerRequest, key.privateKey, key.kid, BROKER_REQUEST_TYPE)
  // An owner's denial of a program call is a 403 whose body the caller needs.
  return await brokerFetch(brokerEndpoint(discovery, 'openape_brokered_grants_endpoint'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assertion }), relayRefusal: operation === 'authorize' })
}

export async function maybeForwardBrokerGrant(event: H3Event, operation: Exclude<BrokerOperation, 'connection'>, input?: unknown): Promise<unknown | undefined> {
  if (!hasBrokerStore()) return undefined
  const caller = await tryBearerAuth(event)
  if (!caller || caller.act !== 'agent' || caller.delegation_grant) return undefined
  const binding = await useBrokerStore(event).getAgent(caller.sub)
  if (!binding) return undefined
  const { userStore, sshKeyStore } = useIdpStores()
  const [user, keys] = await Promise.all([userStore.findByEmail(caller.sub), sshKeyStore.findByUser(caller.sub)])
  if (!user?.isActive || user.type !== 'agent' || keys.length !== 1 || keys[0]?.keyId !== binding.key_id) throw createProblemError({ status: 403, title: 'Brokered agent identity or key is inactive' })
  try { return await forwardBrokerOperation(binding, operation, input, brokerRequesterName(user.name)) }
  catch (error) {
    relayRetryAfter(event, error)
    throw error
  }
}
