export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const { grant_id, authz_jwt, status } = query as Record<string, string>

  if (status === 'denied') {
    return sendRedirect(event, '/dashboard?grant_status=denied')
  }

  if (!authz_jwt || !grant_id) {
    return sendRedirect(event, '/dashboard?grant_status=error')
  }

  // Store the AuthZ-JWT in session
  const session = await getSpSession(event)
  await session.update({
    authzJWT: authz_jwt,
    grantId: grant_id,
  })

  return sendRedirect(event, '/dashboard?grant_status=approved')
})
