import type { OpenApeCliAuthorizationDetail } from '@openape/core'
import { buildWideningSuggestionsForGrant, evaluateStandingGrants, findSimilarCliGrants, introspectGrant } from '@openape/grants'
import { defineEventHandler, getRequestHeader, getRouterParam, setResponseHeader, setResponseStatus } from 'h3'
import { runApprovalDiagnosticHooks } from '../../utils/approval-diagnostic-hooks'
import { useGrantStores } from '../../utils/grant-stores'
import { createProblemError } from '../../utils/problem'

function hasStructuredCliGrant(details?: unknown[]): boolean {
  return (details ?? []).some((d): d is OpenApeCliAuthorizationDetail =>
    typeof d === 'object' && d !== null && (d as Record<string, unknown>).type === 'openape_cli',
  )
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const { grantStore } = useGrantStores()

  if (!id) {
    throw createProblemError({ status: 400, title: 'Grant ID is required' })
  }

  const grant = await introspectGrant(id, grantStore)
  if (!grant) {
    throw createProblemError({ status: 404, title: 'Grant not found', type: 'https://openape.org/errors/grant_not_found' })
  }

  // ETag for efficient polling
  const etag = `W/"${grant.status}:${grant.decided_at || grant.created_at}"`
  setResponseHeader(event, 'ETag', etag)

  const ifNoneMatch = getRequestHeader(event, 'if-none-match')
  if (ifNoneMatch === etag) {
    setResponseStatus(event, 304)
    return ''
  }

  // Why is this still pending? Every auto-approval mechanism can explain its
  // own miss (see approval-diagnostic-hooks). Answering this took a
  // hand-written script against the live policy before — the IdP knows it.
  // Read-only, best-effort: a failing diagnostic costs an explanation, not a
  // grant, and it never influences the decision.
  const pendingDiagnostics = grant.status === 'pending'
    ? await runApprovalDiagnosticHooks(event, grant.request)
    : []
  if (grant.status === 'pending' && hasStructuredCliGrant(grant.request.authorization_details)) {
    const covered = await evaluateStandingGrants(grant.request, grantStore).catch(() => null)
    if (!covered) {
      const clis = [...new Set((grant.request.authorization_details ?? [])
        .filter((d): d is OpenApeCliAuthorizationDetail => d.type === 'openape_cli')
        .map(d => d.cli_id))]
      pendingDiagnostics.push({
        source: 'standing-grant',
        reason: 'no-covering-rule',
        summary: clis.length === 1
          ? `No standing rule covers ${clis[0]} at this scope and risk.`
          : `No standing rule covers all of: ${clis.join(', ')}. A rule is per CLI — a chain needs one for each.`,
        detail: { cliIds: clis },
      })
    }
  }

  // Attach similar grants + widening suggestions for pending CLI grants
  if (grant.status === 'pending' && hasStructuredCliGrant(grant.request.authorization_details)) {
    const existingGrants = await grantStore.findByRequester(grant.request.requester)
    const similarResult = findSimilarCliGrants(grant.request, existingGrants)

    const cliDetails = (grant.request.authorization_details ?? [])
      .filter((d): d is OpenApeCliAuthorizationDetail => d.type === 'openape_cli')
    const wideningSuggestions = cliDetails.length > 0
      ? buildWideningSuggestionsForGrant(cliDetails)
      : undefined

    return {
      ...grant,
      ...(similarResult ? { similar_grants: similarResult } : {}),
      ...(wideningSuggestions ? { widening_suggestions: wideningSuggestions } : {}),
      ...(pendingDiagnostics.length ? { pending_diagnostics: pendingDiagnostics } : {}),
    }
  }

  return pendingDiagnostics.length ? { ...grant, pending_diagnostics: pendingDiagnostics } : grant
})
