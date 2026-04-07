import { introspectGrant, issueAuthzJWT } from '@openape/grants'
import { defineEventHandler, getRouterParam } from 'h3'
import { tryBearerAuth } from '../../../utils/agent-auth'
import { useGrantStores } from '../../../utils/grant-stores'
import { getAppSession } from '../../../utils/session'
import { getIdpIssuer, useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  // Accept both bearer token and session auth
  const bearerPayload = await tryBearerAuth(event)
  let identity: string | undefined = bearerPayload?.sub
  if (!identity) {
    try {
      const session = await getAppSession(event)
      identity = session?.data.userId as string | undefined
    }
    catch {
      // Session may fail if secret is not configured
    }
  }

  if (!identity) {
    throw createProblemError({ status: 401, title: 'Authentication required (agent token or session)' })
  }

  const { grantStore } = useGrantStores()
  const { keyStore } = useIdpStores()

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createProblemError({ status: 400, title: 'Grant ID is required' })
  }

  const grant = await introspectGrant(id, grantStore)
  if (!grant) {
    throw createProblemError({ status: 404, title: 'Grant not found', type: 'https://openape.org/errors/grant_not_found' })
  }

  if (grant.request.requester !== identity) {
    throw createProblemError({ status: 403, title: 'Grant does not belong to this identity' })
  }

  if (grant.status !== 'approved') {
    throw createProblemError({ status: 400, title: `Grant is not approved (status: ${grant.status})`, type: 'https://openape.org/errors/grant_not_approved' })
  }

  const signingKey = await keyStore.getSigningKey()
  const authzJwt = await issueAuthzJWT(grant, getIdpIssuer(), signingKey.privateKey, signingKey.kid)

  return { authz_jwt: authzJwt, grant }
})
