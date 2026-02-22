export default defineEventHandler(async (event) => {
  const adminEmail = await requireAdmin(event)
  const { userStore } = useStores()

  const email = getRouterParam(event, 'email')
  if (!email) {
    throw createError({ statusCode: 400, statusMessage: 'Email is required' })
  }

  const decoded = decodeURIComponent(email)

  if (decoded === adminEmail) {
    throw createError({ statusCode: 400, statusMessage: 'Cannot delete your own account' })
  }

  const existing = await userStore.findByEmail(decoded)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }

  await userStore.deleteUser(decoded)
  return { ok: true }
})
