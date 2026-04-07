import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  const { userStore } = useIdpStores()
  return await userStore.findByOwner(email)
})
