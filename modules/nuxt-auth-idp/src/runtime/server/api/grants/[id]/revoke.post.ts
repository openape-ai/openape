import { revokeGrant } from '@openape/grants'
import { defineEventHandler, getRouterParam } from 'h3'
import { isAdmin, requireAuth } from '../../../utils/admin'
import { tryAgentAuth } from '../../../utils/agent-auth'
import { useGrantStores } from '../../../utils/grant-stores'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const { grantStore } = useGrantStores()
  const { agentStore } = useIdpStores()

  if (!id) {
    throw createProblemError({ status: 400, title: 'Grant ID is required' })
  }

  // Accept both agent token and session auth
  const agentPayload = await tryAgentAuth(event)
  const identity = agentPayload?.sub ?? await requireAuth(event)

  const grant = await grantStore.findById(id)
  if (!grant) {
    throw createProblemError({ status: 404, title: 'Grant not found', type: 'https://openape.org/errors/grant_not_found' })
  }

  // Authorize: requester, approver, or admin
  const isRequester = grant.request.requester === identity
  const agent = await agentStore.findByEmail(grant.request.requester)
  const isApprover = agent && agent.approver === identity
  if (!isRequester && !isApprover && !isAdmin(identity)) {
    throw createProblemError({ status: 403, title: 'Only the requester, agent approver, or admin can revoke this grant' })
  }

  try {
    const revoked = await revokeGrant(id, grantStore)
    return revoked
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to revoke grant'
    throw createProblemError({ status: 400, title: message, type: 'https://openape.org/errors/grant_already_decided' })
  }
})
