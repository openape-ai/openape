import { jwtVerify } from 'jose'

export default defineEventHandler(async (event) => {
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    setResponseStatus(event, 401)
    event.node.res.setHeader('WWW-Authenticate', 'Bearer')
    return { error: 'invalid_token', error_description: 'Bearer token required' }
  }

  const token = authHeader.slice(7)
  const stores = await getStores()
  const signingKey = await stores.keyStore.getSigningKey()
  const config = getIdPConfig()

  let payload: Record<string, unknown>
  try {
    const result = await jwtVerify(token, signingKey.publicKey, {
      issuer: config.issuer,
      algorithms: ['EdDSA'],
    })
    payload = result.payload as Record<string, unknown>
  }
  catch {
    setResponseStatus(event, 401)
    event.node.res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"')
    return { error: 'invalid_token', error_description: 'Invalid or expired token' }
  }

  const claims: Record<string, unknown> = {
    sub: payload.sub,
  }

  if (payload.email) {
    claims.email = payload.email
  }

  if (payload.name) {
    claims.name = payload.name
  }

  return claims
})
