import type { OpenApeCliAuthorizationDetail, OpenApeGrant, OpenApeGrantRequest } from '@openape/core'
import { cliAuthorizationDetailIsSimilar, mergeCliAuthorizationDetails, widenCliAuthorizationDetail } from './cli-permissions.js'

export interface SimilarGrantMatch {
  grant: OpenApeGrant
  similar_detail_indices: number[]
}

export interface SimilarGrantsResult {
  similar_grants: SimilarGrantMatch[]
  widened_details: OpenApeCliAuthorizationDetail[]
  merged_details: OpenApeCliAuthorizationDetail[]
}

function cliDetails(details?: unknown[]): OpenApeCliAuthorizationDetail[] {
  return (details ?? []).filter((d): d is OpenApeCliAuthorizationDetail =>
    typeof d === 'object' && d !== null && (d as Record<string, unknown>).type === 'openape_cli',
  )
}

/**
 * Find existing approved CLI grants that are similar (but not covering) to the incoming request.
 * Returns null if no similar grants are found.
 */
export function findSimilarCliGrants(
  incomingRequest: OpenApeGrantRequest,
  existingGrants: OpenApeGrant[],
): SimilarGrantsResult | null {
  const incomingCliDetails = cliDetails(incomingRequest.authorization_details)
  if (incomingCliDetails.length === 0)
    return null

  const now = Math.floor(Date.now() / 1000)
  const matches: SimilarGrantMatch[] = []

  for (const grant of existingGrants) {
    if (grant.status !== 'approved')
      continue
    if ((grant.request.grant_type ?? 'once') === 'once')
      continue
    if (grant.expires_at && grant.expires_at <= now)
      continue
    if (grant.request.requester !== incomingRequest.requester)
      continue
    if (grant.request.target_host !== incomingRequest.target_host)
      continue
    if (grant.request.audience !== incomingRequest.audience)
      continue
    if (grant.request.run_as !== (incomingRequest.run_as ?? undefined))
      continue
    if (incomingRequest.delegator !== (grant.request.delegator ?? undefined))
      continue
    if (incomingRequest.delegate !== (grant.request.delegate ?? undefined))
      continue
    if ((grant.request.execution_context?.adapter_digest ?? undefined) !== (incomingRequest.execution_context?.adapter_digest ?? undefined))
      continue

    const existingCliDetails = cliDetails(grant.request.authorization_details)
    if (existingCliDetails.length === 0)
      continue

    const similarIndices: number[] = []
    for (let i = 0; i < existingCliDetails.length; i++) {
      const existingDetail = existingCliDetails[i]!
      if (incomingCliDetails.some(incoming => cliAuthorizationDetailIsSimilar(existingDetail, incoming))) {
        similarIndices.push(i)
      }
    }

    if (similarIndices.length > 0) {
      matches.push({ grant, similar_detail_indices: similarIndices })
    }
  }

  if (matches.length === 0)
    return null

  // Compute widened preview: for each similar pair, widen to wildcard
  const allExistingDetails = matches.flatMap(m => cliDetails(m.grant.request.authorization_details))
  let widenedDetails = [...incomingCliDetails]
  for (const existingDetail of allExistingDetails) {
    for (const incomingDetail of incomingCliDetails) {
      if (cliAuthorizationDetailIsSimilar(existingDetail, incomingDetail)) {
        widenedDetails.push(widenCliAuthorizationDetail(existingDetail, incomingDetail))
      }
    }
  }
  widenedDetails = mergeCliAuthorizationDetails(widenedDetails)

  // Compute merged preview: union of all details
  const mergedDetails = mergeCliAuthorizationDetails(
    incomingCliDetails,
    ...matches.map(m => cliDetails(m.grant.request.authorization_details)),
  )

  return {
    similar_grants: matches,
    widened_details: widenedDetails,
    merged_details: mergedDetails,
  }
}
