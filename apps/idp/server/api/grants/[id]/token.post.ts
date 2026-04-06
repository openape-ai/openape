import { introspectGrant, issueAuthzJWT } from '@openape/grants'
import { verifyBearerAuth } from '../../../utils/bearer-auth'

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  const bearerPayload = await verifyBearerAuth(event, stores.keyStore, config.issuer)
  if (!bearerPayload) {
    throw createProblemError({ status: 401, title: 'Bearer token required' })
  }
  const identity = bearerPayload.sub

  const id = getRouterParam(event, 'id')!

  const grant = await introspectGrant(id, stores.grantStore)
  if (!grant) {
    throw createProblemError({ status: 404, title: 'Grant not found' })
  }

  if (grant.request.requester !== identity) {
    throw createProblemError({ status: 403, title: 'Grant does not belong to this identity' })
  }

  if (grant.status !== 'approved') {
    throw createProblemError({ status: 400, title: `Grant is not approved (status: ${grant.status})` })
  }

  const signingKey = await stores.keyStore.getSigningKey()
  const authzJwt = await issueAuthzJWT(grant, config.issuer, signingKey.privateKey, signingKey.kid)

  return { authz_jwt: authzJwt, grant }
})
