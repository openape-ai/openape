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
  if (!agent || agent.type !== 'agent' || !agent.owner || !((caller.act === 'agent' && caller.sub === email) || (caller.act === 'human' && caller.sub === agent.owner))) throw createProblemError({ status: 403, title: 'Pod identity is outside this account' })
  const owner = await userStore.findByEmail(agent.owner)
  const query = getQuery(event)
  if (Object.keys(query).some(key => key !== 'grant') || typeof query.grant !== 'string' || !/^[\w-]{1,128}$/.test(query.grant)) throw createProblemError({ status: 400, title: 'An assigned grant ID is required' })
  const grant = await useGrantStores().grantStore.findById(query.grant)
  const approved = grant?.request.requester === email && (grant.status === 'approved' || (grant.status === 'used' && grant.request.grant_type === 'once')) && (!grant.expires_at || grant.expires_at > Date.now() / 1000)
  const keys = await sshKeyStore.findByUser(email)
  return { email, owner: agent.owner, active: agent.isActive && owner?.isActive === true, keyIds: keys.map(key => key.keyId), grantId: query.grant, grantActive: approved }
})
