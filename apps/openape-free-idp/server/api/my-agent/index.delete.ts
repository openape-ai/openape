import { createError, defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  const { agentStore } = useIdpStores()
  const agents = await agentStore.findByOwner(email)

  if (agents.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'No agent found' })
  }

  await agentStore.delete(agents[0]!.id)
  return { ok: true }
})
