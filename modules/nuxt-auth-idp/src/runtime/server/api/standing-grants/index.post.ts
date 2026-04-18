import type { OpenApeGrant } from '@openape/core'
import type { StandingGrantRequest } from '@openape/grants'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { useGrantStores } from '../../utils/grant-stores'
import { requireAuth } from '../../utils/admin'
import { createProblemError } from '../../utils/problem'

/**
 * POST /api/standing-grants
 *
 * Body: StandingGrantRequest (sans `owner` — filled from session).
 *
 * Creates a pre-approved pattern grant for (owner, delegate). Future agent
 * grant requests from `delegate` that match the `resource_chain_template`
 * will auto-approve via `evaluateStandingGrants()` in the grant-create
 * handler (Milestone 6).
 *
 * Auto-approval semantics: the standing grant is written with
 * status='approved' immediately — the creator IS the approver. Mirrors
 * how `createDelegation()` works for agent-on-behalf-of-human delegations.
 */
export default defineEventHandler(async (event) => {
  const owner = await requireAuth(event)
  const body = await readBody<Partial<StandingGrantRequest>>(event)

  if (!body.delegate || typeof body.delegate !== 'string') {
    throw createProblemError({ status: 400, title: 'Missing delegate' })
  }
  if (!body.audience || typeof body.audience !== 'string') {
    throw createProblemError({ status: 400, title: 'Missing audience' })
  }
  if (!Array.isArray(body.resource_chain_template)) {
    throw createProblemError({ status: 400, title: 'resource_chain_template must be an array' })
  }
  const grantType = body.grant_type ?? 'always'
  if (grantType !== 'timed' && grantType !== 'always') {
    throw createProblemError({ status: 400, title: "grant_type must be 'timed' or 'always'" })
  }
  if (grantType === 'timed' && typeof body.duration !== 'number') {
    throw createProblemError({ status: 400, title: 'duration (seconds) required for timed standing grants' })
  }
  if (body.max_risk && !['low', 'medium', 'high', 'critical'].includes(body.max_risk)) {
    throw createProblemError({ status: 400, title: 'Invalid max_risk' })
  }

  const request: StandingGrantRequest = {
    type: 'standing',
    owner,
    delegate: body.delegate,
    audience: body.audience,
    resource_chain_template: body.resource_chain_template,
    grant_type: grantType,
    ...(body.target_host ? { target_host: body.target_host } : {}),
    ...(body.cli_id ? { cli_id: body.cli_id } : {}),
    ...(body.action ? { action: body.action } : {}),
    ...(body.max_risk ? { max_risk: body.max_risk } : {}),
    ...(body.duration !== undefined ? { duration: body.duration } : {}),
    ...(body.reason ? { reason: body.reason } : {}),
  }

  const { grantStore } = useGrantStores()
  const now = Math.floor(Date.now() / 1000)
  const grant: OpenApeGrant = {
    id: crypto.randomUUID(),
    status: 'approved',
    type: 'standing',
    // request is typed as OpenApeGrantRequest but stored verbatim — the
    // store is JSON-backed and the evaluator reads via isStandingGrantRequest.
    request: request as unknown as OpenApeGrant['request'],
    created_at: now,
    decided_at: now,
    decided_by: owner,
    ...(grantType === 'timed' && body.duration
      ? { expires_at: now + body.duration }
      : {}),
  }
  await grantStore.save(grant)
  setResponseStatus(event, 201)
  return grant
})
