import type { GrantType, OpenApeGrantRequest } from '@openape/core'
import { createGrant } from '@openape/grants'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { tryAgentAuth } from '../../utils/agent-auth'
import { useGrantStores } from '../../utils/grant-stores'
import { createProblemError } from '../../utils/problem'

const VALID_GRANT_TYPES: GrantType[] = ['once', 'timed', 'always']

export default defineEventHandler(async (event) => {
  const body = await readBody<OpenApeGrantRequest>(event)
  const { grantStore } = useGrantStores()

  const agentPayload = await tryAgentAuth(event)
  if (agentPayload) {
    body.requester = agentPayload.sub
  }

  if (!body.requester || !body.target_host || !body.audience) {
    throw createProblemError({ status: 400, title: 'Missing required fields: requester, target_host, audience' })
  }

  // Default grant_type to 'once'
  if (!body.grant_type) {
    body.grant_type = 'once'
  }

  if (!VALID_GRANT_TYPES.includes(body.grant_type)) {
    throw createProblemError({ status: 400, title: `Invalid grant_type. Must be one of: ${VALID_GRANT_TYPES.join(', ')}`, type: 'https://openape.org/errors/invalid_grant_type' })
  }

  if (body.grant_type === 'timed' && !body.duration) {
    throw createProblemError({ status: 400, title: 'Duration is required for timed grants', type: 'https://openape.org/errors/missing_duration' })
  }

  // Grant-Reuse: check for an active reusable grant with matching parameters
  if (body.cmd_hash) {
    const existingGrants = await grantStore.findByRequester(body.requester)
    const now = Math.floor(Date.now() / 1000)
    const reusable = existingGrants.find(g =>
      g.status === 'approved'
      && g.request.target_host === body.target_host
      && g.request.audience === body.audience
      && g.request.cmd_hash === body.cmd_hash
      && (g.request.grant_type ?? 'once') !== 'once'
      && (!g.expires_at || g.expires_at > now)
      && g.request.run_as === (body.run_as ?? undefined),
    )
    if (reusable) {
      return reusable
    }
  }

  const grant = await createGrant(body, grantStore)
  setResponseStatus(event, 201)
  return grant
})
