import type { BrokerRequest } from '@openape/core'
import type { H3Event } from 'h3'
import type { BrokerAgentBinding } from './broker-store'
import { BROKER_REQUEST_TYPE, signBrokerToken } from '@openape/grants'
import { tryBearerAuth } from './agent-auth'
import { brokerEndpoint, brokerFetch, discoverBroker } from './broker-network'
import { hasBrokerStore, useBrokerStore } from './broker-store'
import { createProblemError } from './problem'
import { getIdpIssuer, useIdpStores } from './stores'

export async function forwardBrokerOperation(binding: BrokerAgentBinding, operation: 'connection' | 'create' | 'get' | 'token', input?: unknown): Promise<unknown> {
  const discovery = await discoverBroker(binding.decision_issuer, binding.owner.split('@')[1] ?? '')
  const key = await useIdpStores().keyStore.getSigningKey()
  const now = Math.floor(Date.now() / 1000)
  const common = { iss: getIdpIssuer(), aud: binding.decision_issuer, iat: now, exp: now + 60, jti: crypto.randomUUID(), connection_id: binding.connection_id, owner: binding.owner }
  const identity = { sub: binding.subject, key_id: binding.key_id }
  const request = operation === 'connection' ? { ...common, operation } : operation === 'create' ? { ...common, ...identity, operation, request: input } : { ...common, ...identity, operation, grant_id: input }
  const assertion = await signBrokerToken(request as BrokerRequest, key.privateKey, key.kid, BROKER_REQUEST_TYPE)
  return await brokerFetch(brokerEndpoint(discovery, 'openape_brokered_grants_endpoint'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assertion }) })
}

export async function maybeForwardBrokerGrant(event: H3Event, operation: 'create' | 'get' | 'token', input?: unknown): Promise<unknown | undefined> {
  if (!hasBrokerStore()) return undefined
  const caller = await tryBearerAuth(event)
  if (!caller || caller.act !== 'agent' || caller.delegation_grant) return undefined
  const binding = await useBrokerStore(event).getAgent(caller.sub)
  if (!binding) return undefined
  const { userStore, sshKeyStore } = useIdpStores()
  const [user, keys] = await Promise.all([userStore.findByEmail(caller.sub), sshKeyStore.findByUser(caller.sub)])
  if (!user?.isActive || user.type !== 'agent' || keys.length !== 1 || keys[0]?.keyId !== binding.key_id) throw createProblemError({ status: 403, title: 'Brokered agent identity or key is inactive' })
  return await forwardBrokerOperation(binding, operation, input)
}
