import { issueAuthzJWT } from '@openape/grants'
import { defineEventHandler, getRouterParam } from 'h3'
import { tryAgentAuth } from '../../../utils/agent-auth'
import { useGrantStores } from '../../../utils/grant-stores'
import { getAppSession } from '../../../utils/session'
import { getIdpIssuer, useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  // Accept both agent token and session auth
  const agentPayload = await tryAgentAuth(event)
  const session = !agentPayload ? await getAppSession(event) : null
  const identity = agentPayload?.sub || (session?.data.userId as string | undefined)

  if (!identity) {
    throw createProblemError({ status: 401, title: 'Authentication required (agent token or session)' })
  }

  const { grantStore } = useGrantStores()
  const { keyStore } = useIdpStores()

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createProblemError({ status: 400, title: 'Grant ID is required' })
  }

  const grant = await grantStore.findById(id)
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
