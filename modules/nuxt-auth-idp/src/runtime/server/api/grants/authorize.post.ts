import type { OpenApeProgramAuthorizeRequest } from '@openape/core'
import { InvalidProgramAuthorizeRequestError, parseProgramAuthorizeRequest, PROGRAM_AUTHORIZE_LIMITS } from '@openape/grants'
import type { H3Event } from 'h3'
import { defineEventHandler, getRequestHeader, readRawBody } from 'h3'
import { chargeUnauthenticatedRequest } from '../../plugins/rate-limit'
import { tryBearerAuth } from '../../utils/agent-auth'
import { enforceAuthorizeRateLimit } from '../../utils/authorize-rate-limit'
import { maybeForwardBrokerGrant } from '../../utils/broker-forward'
import { authorizeProgramCall, readForwardedAuthorize, sendProgramAuthorizeResult } from '../../utils/program-authorize'
import { createProblemError } from '../../utils/problem'
import { useIdpStores } from '../../utils/stores'

function tooLarge() {
  return createProblemError({ status: 413, title: `The request body must be at most ${PROGRAM_AUTHORIZE_LIMITS.bodyBytes} bytes` })
}

async function readAuthorizeRequest(event: H3Event): Promise<OpenApeProgramAuthorizeRequest> {
  if (Number(getRequestHeader(event, 'content-length')) > PROGRAM_AUTHORIZE_LIMITS.bodyBytes) throw tooLarge()
  const raw = await readRawBody(event, 'utf8')
  if (!raw) throw createProblemError({ status: 400, title: 'A JSON request body is required' })
  if (Buffer.byteLength(raw, 'utf8') > PROGRAM_AUTHORIZE_LIMITS.bodyBytes) throw tooLarge()
  let input: unknown
  try { input = JSON.parse(raw) }
  catch { throw createProblemError({ status: 400, title: 'The request body is not valid JSON' }) }
  try { return parseProgramAuthorizeRequest(input) }
  catch (error) {
    if (!(error instanceof InvalidProgramAuthorizeRequestError)) throw error
    throw createProblemError({ status: 400, title: error.message })
  }
}

/**
 * POST /api/grants/authorize — per-call program authorization (issue 1473).
 * The requester (bearer token subject) sends the exact command and the hash
 * of its program file; the IdP resolves it with its own shapes and answers
 * 200 with a command token, 202 with a pending request, or 403 when the
 * owner denied or revoked this permission. A brokered identity's call is
 * forwarded to its decision IdP as the signed `authorize` operation.
 */
export default defineEventHandler(async (event) => {
  const caller = await tryBearerAuth(event)
  if (!caller) {
    // Only verified requesters get their own budget; anything else spends the per-IP machine bucket.
    chargeUnauthenticatedRequest(event)
    throw createProblemError({ status: 401, title: 'Authentication required: authorize requests must carry a Bearer token identifying the requester' })
  }
  enforceAuthorizeRateLimit(event, caller.sub)
  const request = await readAuthorizeRequest(event)
  const forwarded = await maybeForwardBrokerGrant(event, 'authorize', request)
  if (forwarded !== undefined) return sendProgramAuthorizeResult(event, readForwardedAuthorize(forwarded))
  const account = await useIdpStores().userStore.findByEmail(caller.sub)
  if (!account?.isActive) throw createProblemError({ status: 403, title: 'The requester account is inactive or missing' })
  return sendProgramAuthorizeResult(event, await authorizeProgramCall(event, { requester: caller.sub, request }))
})
