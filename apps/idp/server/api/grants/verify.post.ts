import { introspectGrant, useGrant, verifyAuthzJWT } from '@openape/grants'

export default defineEventHandler(async (event) => {
  const stores = await getStores()

  const body = await readBody<{ token: string }>(event)

  if (!body?.token) {
    return { valid: false, error: 'Missing token' }
  }

  const signingKey = await stores.keyStore.getSigningKey()
  const result = await verifyAuthzJWT(body.token, {
    publicKey: signingKey.publicKey,
  })

  if (!result.valid) {
    return { valid: false, error: result.error }
  }

  const grantId = result.claims?.grant_id
  if (!grantId) {
    return { valid: false, error: 'Missing grant_id in token' }
  }

  const grant = await introspectGrant(grantId, stores.grantStore)
  if (!grant) {
    return { valid: false, error: 'Grant not found' }
  }

  if (grant.status !== 'approved') {
    return { valid: false, error: `Grant is not approved (status: ${grant.status})` }
  }

  if (grant.request.grant_type === 'once') {
    const used = await useGrant(grantId, stores.grantStore)
    return { valid: true, claims: result.claims, grant: used }
  }

  return { valid: true, claims: result.claims, grant }
})
