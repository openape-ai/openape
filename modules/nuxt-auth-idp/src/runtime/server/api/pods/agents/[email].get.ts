import { brokerObject } from '@openape/grants'
import { hasBrokerStore, useBrokerStore } from '../../../utils/broker-store'
import { forwardBrokerOperation } from '../../../utils/broker-forward'
import { defineEventHandler, getQuery, getRouterParam } from 'h3'
import { tryBearerAuth } from '../../../utils/agent-auth'
import { useIdpStores } from '../../../utils/stores'
import { useGrantStores } from '../../../utils/grant-stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  const caller = await tryBearerAuth(event)
  if (!caller || caller.delegation_grant) throw createProblemError({ status: 401, title: 'Direct identity authentication is required' })
  const email = getRouterParam(event, 'email')
  if (!email) throw createProblemError({ status: 400, title: 'Pod identity is required' })
  const { userStore, sshKeyStore } = useIdpStores()
  const agent = await userStore.findByEmail(email)
  const binding = hasBrokerStore() ? await useBrokerStore(event).getAgent(email) : null
  if (!binding && (!agent || agent.type !== 'agent' || !agent.owner || !((caller.act === 'agent' && caller.sub === email) || (caller.act === 'human' && caller.sub === agent.owner)))) throw createProblemError({ status: 403, title: 'Pod identity is outside this account' })
  const query = getQuery(event)
  // Without a grant the reply covers only the identity, its keys and owner (a running Pod's revocation check).
  if (Object.keys(query).some(key => key !== 'grant') || (query.grant !== undefined && (typeof query.grant !== 'string' || !/^[\w-]{1,128}$/.test(query.grant)))) throw createProblemError({ status: 400, title: 'Invalid assigned grant ID' })
  const grantId = query.grant as string | undefined
  if (!agent) throw createProblemError({ status: 403, title: 'Agent identity is missing' })
  if (binding) {
    if (caller.act !== 'agent' || caller.sub !== email) throw createProblemError({ status: 403, title: 'Agent authentication is required' })
    const keys = await sshKeyStore.findByUser(email)
    const identity = { email, owner: binding.owner, active: agent.isActive && keys.length === 1 && keys[0]?.keyId === binding.key_id, keyIds: keys.map(key => key.keyId) }
    if (!grantId) {
      // The owner revokes the broker connection at the decision IdP; it answers a revoked connection with a 403 refusal.
      const connection = brokerObject(await forwardBrokerOperation(binding, 'connection'))
      return { ...identity, active: identity.active && connection.id === binding.connection_id && connection.status === 'active' }
    }
    const grant = brokerObject(await forwardBrokerOperation(binding, 'get', grantId))
    return { ...identity, grantId, grantActive: grant.id === grantId && activeGrant(grant, email) }
  }
  const owner = agent.owner ? await userStore.findByEmail(agent.owner) : null
  const keys = await sshKeyStore.findByUser(email)
  const identity = { email, owner: agent.owner, active: agent.isActive && owner?.isActive === true, keyIds: keys.map(key => key.keyId) }
  if (!grantId) return identity
  const grant = await useGrantStores().grantStore.findById(grantId)
  return { ...identity, grantId, grantActive: activeGrant(grant, email) }
})

function activeGrant(value: unknown, email: string): boolean {
  if (!value || typeof value !== 'object') return false
  const grant = value as { status?: unknown, expires_at?: unknown, request?: { requester?: unknown, grant_type?: unknown } }
  if (grant.request?.requester !== email) return false
  if (grant.expires_at != null && (typeof grant.expires_at !== 'number' || grant.expires_at <= Date.now() / 1000)) return false
  return grant.status === 'approved' || (grant.status === 'used' && grant.request.grant_type === 'once')
}
