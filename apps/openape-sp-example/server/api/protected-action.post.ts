export default defineEventHandler(async (event) => {
  const session = await getSession(event)
  const data = session.data as Record<string, unknown>
  const claims = data.claims as { sub?: string } | undefined

  if (!claims?.sub) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  // Check for AuthZ-JWT in Authorization header or session
  const authHeader = getHeader(event, 'authorization')
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (data.authzJWT as string | undefined)

  if (!token) {
    throw createError({ statusCode: 403, statusMessage: 'Authorization JWT required. Please request permission first.' })
  }

  const { openapeUrl } = getSpConfig()

  // Verify the AuthZ-JWT and consume once-grants via the IdP verify endpoint
  const result = await $fetch<{ valid: boolean, claims?: Record<string, unknown>, grant?: { status: string, request: { grant_type: string } }, error?: string }>(`${openapeUrl}/api/grants/verify`, {
    method: 'POST',
    body: { token },
  })

  if (!result.valid) {
    // Clear stale session data so user can request a new grant
    await session.update({ authzJWT: undefined, grantId: undefined })
    throw createError({ statusCode: 403, statusMessage: `Authorization failed: ${result.error}` })
  }

  // Once-grant consumed — clear session so user can request a new one
  const grantConsumed = result.grant?.request?.grant_type === 'once'
  if (grantConsumed) {
    await session.update({ authzJWT: undefined, grantId: undefined })
  }

  return {
    success: true,
    message: 'Protected action executed successfully',
    user: claims.sub,
    grant: result.claims,
    grantConsumed,
    timestamp: new Date().toISOString(),
  }
})
