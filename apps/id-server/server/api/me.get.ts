export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)

  if (!session.data.userId) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  return {
    email: session.data.userId,
    name: session.data.userName,
    isAdmin: isAdmin(session.data.userId as string) || session.data.isSuperAdmin === true,
  }
})
