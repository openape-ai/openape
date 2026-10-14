import type { BrokeredGrant, OpenApeAuthorizationDetail, OpenApeCliAuthorizationDetail, OpenApeGrant, OpenApeGrantRequest } from '@openape/core'
import { canonicalizeCliPermission, cliAuthorizationDetailsCover, isCliAuthorizationDetailExact, sameBrokeredGrant } from '@openape/grants'

function cliDetails(details?: OpenApeAuthorizationDetail[]): OpenApeCliAuthorizationDetail[] {
  return (details ?? []).filter((detail): detail is OpenApeCliAuthorizationDetail => detail.type === 'openape_cli')
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

function hasExactStructuredDetail(request: Pick<OpenApeGrantRequest, 'authorization_details'>): boolean {
  return cliDetails(request.authorization_details).some(isCliAuthorizationDetailExact)
}

function reusable(grant: OpenApeGrant, request: OpenApeGrantRequest, brokered: BrokeredGrant | undefined, now: number): boolean {
  if (grant.status !== 'approved') return false
  if ((grant.request.grant_type ?? 'once') === 'once') return false
  if (grant.expires_at && grant.expires_at <= now) return false
  // A brokered identity reuses only grants of its own broker binding; a direct identity never reuses a brokered one.
  if (!sameBrokeredGrant(grant.brokered, brokered)) return false
  if (grant.request.target_host !== request.target_host) return false
  if (grant.request.audience !== request.audience) return false
  if (grant.request.run_as !== (request.run_as ?? undefined)) return false
  if (request.delegator !== (grant.request.delegator ?? undefined)) return false
  if (request.delegate !== (grant.request.delegate ?? undefined)) return false

  const incoming = cliDetails(request.authorization_details)
  const existing = cliDetails(grant.request.authorization_details)
  if (incoming.length || existing.length) {
    if (!incoming.length || !existing.length) return false
    if ((grant.request.execution_context?.adapter_digest ?? undefined) !== (request.execution_context?.adapter_digest ?? undefined)) return false
    if (!cliAuthorizationDetailsCover(existing, incoming)) return false
    if (hasExactStructuredDetail(request) || hasExactStructuredDetail(grant.request)) {
      if ((grant.request.execution_context?.argv_hash ?? undefined) !== (request.execution_context?.argv_hash ?? undefined)) return false
    }
    return true
  }

  // Exact command grants reuse only on exact command binding.
  if ((request.cmd_hash || grant.request.cmd_hash) && grant.request.cmd_hash !== request.cmd_hash) return false
  if (request.permissions || grant.request.permissions) {
    if ((request.permissions ?? []).toSorted().join(',') !== (grant.request.permissions ?? []).toSorted().join(',')) return false
  }
  if (request.authorization_details || grant.request.authorization_details) {
    const requested = (request.authorization_details ?? []).map(detailSignature).toSorted().join(',')
    const granted = (grant.request.authorization_details ?? []).map(detailSignature).toSorted().join(',')
    if (requested !== granted) return false
  }
  return true
}

/**
 * An approved continuing grant of the requester that already covers `request`
 * (same host, audience, adapter and broker binding), so the request needs no
 * new decision. Single-use grants are never reused.
 */
export function findReusableGrant(existing: OpenApeGrant[], request: OpenApeGrantRequest, brokered?: BrokeredGrant): OpenApeGrant | undefined {
  const now = Math.floor(Date.now() / 1000)
  return existing.find(grant => reusable(grant, request, brokered, now))
}
