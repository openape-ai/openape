import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  const { agentStore } = useIdpStores()
  return await agentStore.findByOwner(email)
})
