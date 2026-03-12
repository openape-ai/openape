import { defineEventHandler, getRouterParam } from 'h3'
import { requireAdmin } from '../../../utils/admin'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { agentStore } = useIdpStores()

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createProblemError({ status: 400, title: 'Agent ID is required' })
  }

  const existing = await agentStore.findById(id)
  if (!existing) {
    throw createProblemError({ status: 404, title: 'Agent not found' })
  }

  await agentStore.delete(id)
  return { ok: true }
})
