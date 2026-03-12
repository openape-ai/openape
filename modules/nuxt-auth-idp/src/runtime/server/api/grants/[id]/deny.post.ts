import { denyGrant } from '@openape/grants'
import { defineEventHandler, getRouterParam } from 'h3'
import { isAdmin, requireAuth } from '../../../utils/admin'
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

  const agent = await agentStore.findByEmail(grant.request.requester)
  if (agent && agent.approver !== email && !isAdmin(email)) {
    throw createProblemError({ status: 403, title: 'Only the agent approver or admin can deny this grant' })
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
