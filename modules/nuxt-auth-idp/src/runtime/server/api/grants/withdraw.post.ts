import { grantReferenceKey, InvalidGrantWithdrawError, parseGrantWithdrawRequest, parseGrantWithdrawResult, withdrawReferencedGrant } from '@openape/grants'
import { defineEventHandler, readBody, setHeader } from 'h3'
import { chargeUnauthenticatedRequest } from '../../plugins/rate-limit'
import { tryBearerAuth } from '../../utils/agent-auth'
import { maybeForwardBrokerGrant } from '../../utils/broker-forward'
import { useGrantStores } from '../../utils/grant-stores'
import { createProblemError } from '../../utils/problem'
import { useIdpStores } from '../../utils/stores'

/**
 * POST /api/grants/withdraw — the requester withdraws its own referenced
 * single-use request (grants.md §4.11, issue 1536). Only the bearer token's
 * subject is searched, so another requester's reference answers `unknown`.
 * A brokered identity's request is withdrawn at its decision IdP through the
 * signed `withdraw` operation.
 */
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const caller = await tryBearerAuth(event)
  if (!caller) {
    chargeUnauthenticatedRequest(event)
    throw createProblemError({ status: 401, title: 'Authentication required: only the requester can withdraw its request' })
  }
  if (caller.delegation_grant) throw createProblemError({ status: 403, title: 'A delegated session cannot withdraw requests' })
  let input: ReturnType<typeof parseGrantWithdrawRequest>
  try { input = parseGrantWithdrawRequest(await readBody<unknown>(event)) }
  catch (error) {
    if (!(error instanceof InvalidGrantWithdrawError)) throw error
    throw createProblemError({ status: 400, title: error.message })
  }
  const forwarded = await maybeForwardBrokerGrant(event, 'withdraw', input)
  if (forwarded !== undefined) {
    try { return parseGrantWithdrawResult(forwarded) }
    catch { throw createProblemError({ status: 503, title: 'The decision identity provider returned an invalid withdrawal answer', type: 'https://openape.org/errors/broker_unavailable' }) }
  }
  const account = await useIdpStores().userStore.findByEmail(caller.sub)
  if (!account?.isActive) throw createProblemError({ status: 403, title: 'The requester account is inactive or missing' })
  const { grantStore } = useGrantStores()
  if (!grantStore.withdraw) throw createProblemError({ status: 501, title: 'This store does not support withdrawing grant requests' })
  return await withdrawReferencedGrant(grantReferenceKey(caller.sub, input.reference), input.reason, grantStore)
})
