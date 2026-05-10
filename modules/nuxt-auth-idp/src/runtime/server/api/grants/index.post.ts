import type { GrantType, OpenApeAuthorizationDetail, OpenApeCliAuthorizationDetail, OpenApeGrantRequest } from '@openape/core'
import { computeCmdHash } from '@openape/core'
import { canonicalizeCliPermission, cliAuthorizationDetailsCover, computeArgvHash, createGrant, evaluateStandingGrants, findSimilarCliGrants, isCliAuthorizationDetailExact, validateCliAuthorizationDetail } from '@openape/grants'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { tryBearerAuth } from '../../utils/agent-auth'
import { useGrantStores } from '../../utils/grant-stores'
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

function detailSignature(detail: OpenApeAuthorizationDetail): string {
  if (detail.type !== 'openape_cli')
    return JSON.stringify(detail)

  const normalizedChain = detail.resource_chain.map(resource => ({
    resource: resource.resource,
    ...(resource.selector
      ? { selector: Object.fromEntries(Object.entries(resource.selector).sort(([a], [b]) => a.localeCompare(b))) }
      : {}
    ),
  }))

  return JSON.stringify({
    ...detail,
    permission: canonicalizeCliPermission(detail),
    resource_chain: normalizedChain,
  })
}

function cliDetails(details?: OpenApeAuthorizationDetail[]): OpenApeCliAuthorizationDetail[] {
  return (details ?? []).filter((detail): detail is OpenApeCliAuthorizationDetail => detail.type === 'openape_cli')
}

function hasStructuredCliGrant(request: Pick<OpenApeGrantRequest, 'authorization_details'>): boolean {
  return cliDetails(request.authorization_details).length > 0
}

function hasExactStructuredDetail(request: Pick<OpenApeGrantRequest, 'authorization_details'>): boolean {
  return cliDetails(request.authorization_details).some(isCliAuthorizationDetailExact)
}

export default defineEventHandler(async (event) => {
  const body = await readBody<OpenApeGrantRequest>(event)
  const { grantStore } = useGrantStores()

  const bearerPayload = await tryBearerAuth(event)
  if (bearerPayload) {
    body.requester = bearerPayload.sub
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

  body.authorization_details = normalizeAuthorizationDetails(body.authorization_details)

  if (body.authorization_details?.length) {
    body.permissions = body.authorization_details.map(detail =>
      detail.type === 'openape_cli' ? canonicalizeCliPermission(detail) : detail.action,
    )
  }

  const executionContext = body.execution_context
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

  // Grant-Reuse: check for an active reusable grant with matching parameters
  // Only timed/always grants are reusable (once grants are single-use by definition)
  {
    const existingGrants = await grantStore.findByRequester(body.requester)
    const now = Math.floor(Date.now() / 1000)
    const reusable = existingGrants.find((g) => {
      if (g.status !== 'approved') return false
      if ((g.request.grant_type ?? 'once') === 'once') return false
      if (g.expires_at && g.expires_at <= now) return false
      if (g.request.target_host !== body.target_host) return false
      if (g.request.audience !== body.audience) return false
      if (g.request.run_as !== (body.run_as ?? undefined)) return false
      // Match delegation fields
      if (body.delegator !== (g.request.delegator ?? undefined)) return false
      if (body.delegate !== (g.request.delegate ?? undefined)) return false

      const incomingStructured = hasStructuredCliGrant(body)
      const existingStructured = hasStructuredCliGrant(g.request)

      if (incomingStructured || existingStructured) {
        if (!incomingStructured || !existingStructured) return false
        if ((g.request.execution_context?.adapter_digest ?? undefined) !== (body.execution_context?.adapter_digest ?? undefined)) return false

        if (!cliAuthorizationDetailsCover(cliDetails(g.request.authorization_details), cliDetails(body.authorization_details))) {
          return false
        }

        if (hasExactStructuredDetail(body) || hasExactStructuredDetail(g.request)) {
          if ((g.request.execution_context?.argv_hash ?? undefined) !== (body.execution_context?.argv_hash ?? undefined)) {
            return false
          }
        }
        return true
      }

      // Exact command grants reuse only on exact command binding.
      if (body.cmd_hash || g.request.cmd_hash) {
        if (g.request.cmd_hash !== body.cmd_hash) return false
      }
      if (body.permissions || g.request.permissions) {
        const reqPerms = (body.permissions ?? []).toSorted().join(',')
        const grantPerms = (g.request.permissions ?? []).toSorted().join(',')
        if (reqPerms !== grantPerms) return false
      }
      if (body.authorization_details || g.request.authorization_details) {
        const reqDetails = (body.authorization_details ?? []).map(detailSignature).toSorted().join(',')
        const grantDetails = (g.request.authorization_details ?? []).map(detailSignature).toSorted().join(',')
        if (reqDetails !== grantDetails) return false
      }
      return true
    })
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
        const grant = await createGrant(body, grantStore)
        // Grant landed in pending state and needs human approval —
        // fan out a push / mail / etc. via registered hooks.
        // Fire-and-forget so a slow notification doesn't delay the
        // grant-creation response.
        void runGrantPendingHooks(grant).catch(err =>
          console.warn('[grants/post] pending-hook failed:', err),
        )
        setResponseStatus(event, 201)
        return { ...grant, similar_grants: similarResult }
      }
    }
  }

  const grant = await createGrant(body, grantStore)
  // Grant landed in pending state — notify the human.
  void runGrantPendingHooks(grant).catch(err =>
    console.warn('[grants/post] pending-hook failed:', err),
  )
  setResponseStatus(event, 201)
  return grant
})
