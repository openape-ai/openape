import { createError, defineEventHandler, getRouterParam } from 'h3'

export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing agent ID' })
  }

  const { agentStore } = useIdpStores()
  const agent = await agentStore.findById(id)

  if (!agent || agent.owner !== email) {
    throw createError({ statusCode: 404, statusMessage: 'Agent not found' })
  }

  return agent
})
