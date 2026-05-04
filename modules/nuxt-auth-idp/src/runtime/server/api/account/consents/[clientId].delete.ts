import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { getAppSession } from '../../../utils/session'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

/**
 * Revoke a previously-granted consent for one SP. The user will see
 * the consent screen again on their next /authorize against this
 * client_id (DDISA core.md §2.3, #301 follow-up).
 *
 * Idempotent: revoking a non-existent consent returns 204 too. Avoids
 * leaking which SPs the user has actually approved.
 */
export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  if (!session.data.userId) {
    throw createProblemError({ status: 401, title: 'Not authenticated' })
  }

  const clientId = getRouterParam(event, 'clientId')
  if (!clientId) {
    throw createProblemError({ status: 400, title: 'Missing clientId' })
  }

  const { consentStore } = useIdpStores()
  await consentStore.revoke(session.data.userId, decodeURIComponent(clientId))

  setResponseStatus(event, 204)
  return null
})
