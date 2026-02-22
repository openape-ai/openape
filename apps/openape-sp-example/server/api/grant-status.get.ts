export default defineEventHandler(async (event) => {
  const session = await getSession(event)
  const data = session.data as Record<string, unknown>
  return {
    hasAuthzJWT: !!data.authzJWT,
  }
})
