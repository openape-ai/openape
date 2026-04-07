import { createError, defineEventHandler, getRouterParam } from 'h3'

export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing user ID' })
  }

  const { userStore, sshKeyStore } = useIdpStores()
  const userEmail = decodeURIComponent(id)
  const user = await userStore.findByEmail(userEmail)

  if (!user || user.owner !== email) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }

  await sshKeyStore.deleteAllForUser(userEmail)
  await userStore.delete(userEmail)
  return { ok: true }
})
