import { denyGrant } from '@openape/grants'
import { defineEventHandler, getRouterParam } from 'h3'
import { requireAuth } from '../../../utils/admin'
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

  const email = await requireAuth(event)

  const grant = await grantStore.findById(id)
  if (!grant) {
    throw createProblemError({ status: 404, title: 'Grant not found', type: 'https://openape.org/errors/grant_not_found' })
  }

  // Allow if the logged-in user is the requester themselves
  const isRequester = grant.request.requester === email
  if (!isRequester) {
    const agent = await agentStore.findByEmail(grant.request.requester)
    if (!agent) {
      throw createProblemError({ status: 403, title: 'Agent not found for this grant' })
    }
    const isOwnerOrApprover = agent.owner === email || agent.approver === email
    if (!isOwnerOrApprover) {
      throw createProblemError({ status: 403, title: 'Only the agent owner or approver can deny this grant' })
    }
  }

  try {
    const denied = await denyGrant(id, email, grantStore)
    return denied
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to deny grant'
    throw createProblemError({ status: 400, title: message, type: 'https://openape.org/errors/grant_already_decided' })
  }
})
