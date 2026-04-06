import { introspectGrant, useGrant, verifyAuthzJWT } from '@openape/grants'

export default defineEventHandler(async (event) => {
  const stores = await getStores()

  const id = getRouterParam(event, 'id')!

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw createProblemError({ status: 401, title: 'Missing or invalid Authorization header' })
  }
  const token = authHeader.slice(7)

  const signingKey = await stores.keyStore.getSigningKey()
  const result = await verifyAuthzJWT(token, {
    publicKey: signingKey.publicKey,
  })

  if (!result.valid) {
    throw createProblemError({ status: 401, title: `Invalid grant token: ${result.error}` })
  }

  if (result.claims?.grant_id !== id) {
    throw createProblemError({ status: 400, title: 'Grant ID in token does not match URL' })
  }

  const grant = await introspectGrant(id, stores.grantStore)
  if (!grant) {
    throw createProblemError({ status: 404, title: 'Grant not found' })
  }

  switch (grant.status) {
    case 'used':
      return { error: 'already_consumed', status: grant.status }
    case 'revoked':
      return { error: 'revoked', status: grant.status }
    case 'denied':
      return { error: 'denied', status: grant.status }
    case 'expired':
      return { error: 'expired', status: grant.status }
    case 'pending':
      return { error: 'not_approved', status: grant.status }
  }

  if (grant.request.grant_type === 'once') {
    const used = await useGrant(id, stores.grantStore)
    return { status: 'consumed', grant: used }
  }

  return { status: 'valid', grant }
})
