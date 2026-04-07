import { createError, defineEventHandler, getRouterParam } from 'h3'

export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing user ID' })
  }

  const { userStore } = useIdpStores()
  const user = await userStore.findByEmail(decodeURIComponent(id))

  if (!user || user.owner !== email) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }

  return user
})
