export default defineEventHandler(async (event) => {
  const contentType = getRequestHeader(event, 'content-type') || ''
  const rawBody = await readRawBody(event, 'utf-8') || ''

  let body: Record<string, string>
  if (contentType.includes('application/x-www-form-urlencoded')) {
    body = Object.fromEntries(new URLSearchParams(rawBody))
  }
  else {
    try {
      body = JSON.parse(rawBody || '{}')
    }
    catch {
      throw createProblemError({ status: 400, title: 'Invalid JSON body' })
    }
  }

  const token = body.token
  if (!token) {
    throw createProblemError({ status: 400, title: 'Missing token' })
  }

  const stores = await getStores()

  // RFC 7009: revocation endpoint always returns 200,
  // even if the token is invalid or already revoked
  try {
    await stores.refreshTokenStore.revokeByToken(token)
  }
  catch {
    // Per RFC 7009, we still return 200
  }

  return { status: 'ok' }
})
