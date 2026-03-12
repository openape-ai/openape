import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  const { agentStore } = useIdpStores()
  const agents = await agentStore.findByOwner(email)
  return agents[0] ?? null
})
