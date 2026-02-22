export default defineEventHandler(async (event) => {
  const session = await getSession(event)
  const data = session.data as Record<string, unknown>

  if (!data.claims) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  return data.claims
})
