import { maybeForwardBrokerGrant } from '../../utils/broker-forward'
import type { BrokeredGrant, GrantType, OpenApeAuthorizationDetail, OpenApeCliAuthorizationDetail, OpenApeGrant, OpenApeGrantRequest } from '@openape/core'
import { computeCmdHash, GRANTS_REQUEST_SCOPE } from '@openape/core'
import { assertGrantBatchMember, canonicalizeCliPermission, computeArgvHash, createGrant, evaluateStandingGrants, findSimilarCliGrants, InvalidGrantBatchError, InvalidGrantSummaryError, parseGrantBatch, parseGrantSummary, validateCliAuthorizationDetail } from '@openape/grants'
import type { H3Event } from 'h3'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { hasValidManagementToken } from '../../utils/admin'
import { tryBearerAuth } from '../../utils/agent-auth'
import { allowUnauthenticatedGrantRequests } from '../../utils/grant-request-auth'
import { useGrantStores } from '../../utils/grant-stores'
import { findReusableGrant } from '../../utils/grant-reuse'
import { assertDelegatedRequest, tryGrantsDelegate } from '../../utils/grants-delegation'
import { runGrantPendingHooks } from '../../utils/grant-pending-hooks'
import { runPreApprovalHooks } from '../../utils/pre-approval-hooks'
import { createProblemError } from '../../utils/problem'

const VALID_GRANT_TYPES: GrantType[] = ['once', 'timed', 'always']

function normalizeAuthorizationDetails(details?: OpenApeAuthorizationDetail[]): OpenApeAuthorizationDetail[] | undefined {
  if (!details?.length)
    return undefined

  return details.map((detail) => {
    if (detail.type !== 'openape_cli')
      return detail

    const result = validateCliAuthorizationDetail(detail)
    if (!result.valid) {
      throw createProblemError({
        status: 400,
        title: `Invalid authorization_details entry: ${result.errors.join('; ')}`,
      })
    }

    const permission = canonicalizeCliPermission(detail)
    return {
      ...detail,
      permission,
    } satisfies OpenApeCliAuthorizationDetail
  })
}

function cliDetails(details?: OpenApeAuthorizationDetail[]): OpenApeCliAuthorizationDetail[] {
  return (details ?? []).filter((detail): detail is OpenApeCliAuthorizationDetail => detail.type === 'openape_cli')
}

/**
 * Stores the request as pending and notifies whoever decides it. A request
 * for a brokered identity keeps that identity's broker binding, so only its
 * broker can later use the grant.
 */
async function createPendingGrant(event: H3Event, request: OpenApeGrantRequest, brokered?: BrokeredGrant): Promise<OpenApeGrant> {
  const { grantStore } = useGrantStores()
  let grant: OpenApeGrant
  if (brokered) {
    grant = { id: crypto.randomUUID(), status: 'pending', type: 'command', request, brokered, created_at: Math.floor(Date.now() / 1000) }
    await grantStore.save(grant)
  }
  else {
    grant = await createGrant(request, grantStore)
  }
  // Fire-and-forget so a slow notification doesn't delay the response.
  void runGrantPendingHooks(grant).catch(err =>
    console.warn('[grants/post] pending-hook failed:', err))
  setResponseStatus(event, 201)
  return grant
}

export default defineEventHandler(async (event) => {
  const body = await readBody<OpenApeGrantRequest>(event)
  // Provenance is the IdP's to record, never the client's.
  delete body.submitted_by
  const forwarded = await maybeForwardBrokerGrant(event, 'create', body)
  if (forwarded !== undefined) return forwarded
  const { grantStore } = useGrantStores()

  // Spec §5: grant requests MUST carry a Bearer token; §3.4: an authenticated
  // requester is always the token's subject — a body-supplied `requester` is
  // display data an attacker controls, never an identity. The one exception
  // is a `grants:request` delegate, which names one of its delegator's agents
  // (delegation.md §8); the IdP records it as the submitter.
  const delegate = await tryGrantsDelegate(event, GRANTS_REQUEST_SCOPE)
  const bearerPayload = delegate ? null : await tryBearerAuth(event)
  const delegated = delegate ? await assertDelegatedRequest(event, body, delegate) : undefined
  if (delegate) {
    body.submitted_by = { delegate: delegate.delegate, delegation_grant: delegate.delegationGrant }
  }
  else if (bearerPayload) {
    body.requester = bearerPayload.sub
  }
  else if (!hasValidManagementToken(event) && !allowUnauthenticatedGrantRequests()) {
    // Management-token callers (admin tooling, test harnesses) may set
    // `requester` freely — the token is a deliberate operator secret.
    throw createProblemError({
      status: 401,
      title: 'Authentication required: grant requests must carry a Bearer token identifying the requester',
    })
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

  try {
    body.summary = parseGrantSummary(body.summary)
  }
  catch (error) {
    if (!(error instanceof InvalidGrantSummaryError)) throw error
    throw createProblemError({ status: 400, title: `Invalid summary: ${error.message}` })
  }

  try {
    body.batch = parseGrantBatch(body.batch)
    await assertGrantBatchMember(body, grantStore)
  }
  catch (error) {
    if (!(error instanceof InvalidGrantBatchError)) throw error
    throw createProblemError({ status: 400, title: `Invalid batch: ${error.message}` })
  }

  body.authorization_details = normalizeAuthorizationDetails(body.authorization_details)

  if (body.authorization_details?.length) {
    body.permissions = body.authorization_details.map(detail =>
      detail.type === 'openape_cli' ? canonicalizeCliPermission(detail) : detail.action)
  }

  const executionContext = body.execution_context
  // The grant card treats these as the IdP's own resolution (POST /api/grants/authorize).
  if (executionContext && ('program_sha256' in executionContext || 'version_tested' in executionContext)) {
    throw createProblemError({ status: 400, title: 'execution_context.program_sha256 and version_tested are set by the IdP; use POST /api/grants/authorize' })
  }
  const executionArgv = executionContext?.argv
  if (executionContext && executionArgv?.length) {
    body.execution_context = {
      ...executionContext,
      argv_hash: await computeArgvHash(executionArgv),
      resolved_executable: executionContext.resolved_executable || executionArgv[0] || '',
    }
    if (!body.command?.length) {
      body.command = [...executionArgv]
    }
  }

  // Compute cmd_hash server-side from command array (never trust client-provided hash)
  if (body.command?.length) {
    body.cmd_hash = await computeCmdHash(body.command.join(' '))
  }

  // A delegate's request is always left to the delegator's decision: no
  // reuse, standing-grant or hook approval may settle it (requester ≠ approver).
  if (delegate) {
    return await createPendingGrant(event, body, delegated?.brokered)
  }

  // Grant-Reuse: an approved continuing grant that already covers the request
  // is returned instead of asking again (once grants are single-use).
  {
    const existingGrants = await grantStore.findByRequester(body.requester)
    const reusable = findReusableGrant(existingGrants, body)
    if (reusable) {
      return reusable
    }

    // Standing-grant auto-approval: if any of the requester's (=delegate's)
    // standing grants covers the incoming authorization_details, create
    // the grant with status='approved' directly and record the standing
    // grant's id for audit trail. This is the Phase 1 policy-shift hook.
    const standingMatch = await evaluateStandingGrants(body, grantStore)
    if (standingMatch) {
      const pendingGrant = await createGrant(body, grantStore)
      const now = Math.floor(Date.now() / 1000)
      const approvedExtra = {
        status: 'approved' as const,
        decided_at: now,
        // decided_by = the standing grant's owner (the user who pre-authorized).
        // We derive it from the standing grant via its id — look up once.
        decided_by: (await grantStore.findById(standingMatch.standing_grant_id))?.decided_by ?? undefined,
        decided_by_standing_grant: standingMatch.standing_grant_id,
        auto_approval_kind: 'standing' as const,
      }
      await grantStore.updateStatus(pendingGrant.id, 'approved', approvedExtra)
      const approvedGrant = await grantStore.findById(pendingGrant.id)
      setResponseStatus(event, 201)
      return { ...approvedGrant, approved_automatically: true }
    }

    // Generic pre-approval hook. Runs after standing-grant miss so standing
    // grants stay the more specific match. Consuming apps register hooks via
    // `definePreApprovalHook` (see e.g. openape-free-idp's YOLO plugin).
    {
      const preApproval = await runPreApprovalHooks(event, body)
      if (preApproval) {
        const pendingGrant = await createGrant(body, grantStore)
        const now = Math.floor(Date.now() / 1000)
        await grantStore.updateStatus(pendingGrant.id, 'approved', {
          status: 'approved' as const,
          decided_at: now,
          decided_by: preApproval.decidedBy,
          auto_approval_kind: preApproval.kind,
        } as Record<string, unknown>)
        const approvedGrant = await grantStore.findById(pendingGrant.id)
        setResponseStatus(event, 201)
        return { ...approvedGrant, approved_automatically: true }
      }
    }

    // Similarity check: find approved CLI grants that overlap but don't cover
    const incomingCliDetails = cliDetails(body.authorization_details)
    if (incomingCliDetails.length > 0) {
      const similarResult = findSimilarCliGrants(body, existingGrants)
      if (similarResult) {
        return { ...await createPendingGrant(event, body), similar_grants: similarResult }
      }
    }
  }

  return await createPendingGrant(event, body)
})
