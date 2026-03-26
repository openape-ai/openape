import type { GrantType, OpenApeCliAuthorizationDetail, OpenApeGrant, OpenApeGrantRequest } from '@openape/core'
import { canonicalizeCliPermission, cliAuthorizationDetailIsSimilar, mergeCliAuthorizationDetails, widenCliAuthorizationDetail } from '@openape/core'
import type { GrantStore } from './stores.js'

export type ExtendMode = 'widen' | 'merge'

export interface ApproveGrantOverrides {
  grant_type?: GrantType
  duration?: number
  extend_mode?: ExtendMode
  extend_grant_ids?: string[]
}

/**
 * Create a new grant with status 'pending'.
 */
export async function createGrant(
  request: OpenApeGrantRequest,
  store: GrantStore,
): Promise<OpenApeGrant> {
  const grant: OpenApeGrant = {
    id: crypto.randomUUID(),
    request,
    status: 'pending',
    created_at: Math.floor(Date.now() / 1000),
  }
  await store.save(grant)
  return grant
}

/**
 * Approve a grant. For 'timed' grants, sets expires_at based on request duration.
 * Overrides allow the approver to change grant_type and/or duration.
 */
export async function approveGrant(
  grantId: string,
  approver: string,
  store: GrantStore,
  overrides?: ApproveGrantOverrides,
): Promise<OpenApeGrant> {
  const grant = await store.findById(grantId)
  if (!grant) {
    throw new Error(`Grant not found: ${grantId}`)
  }
  if (grant.status !== 'pending') {
    throw new Error(`Grant is not pending: ${grant.status}`)
  }

  const effectiveType = overrides?.grant_type ?? grant.request.grant_type ?? 'once'
  const effectiveDuration = overrides?.duration ?? grant.request.duration

  if (effectiveType === 'timed' && !effectiveDuration) {
    throw new Error('Duration is required for timed grants')
  }

  const modifiedRequest: OpenApeGrantRequest = {
    ...grant.request,
    grant_type: effectiveType,
    ...(effectiveDuration !== undefined ? { duration: effectiveDuration } : {}),
  }

  const now = Math.floor(Date.now() / 1000)
  const extra: Partial<OpenApeGrant> = {
    decided_by: approver,
    decided_at: now,
    request: modifiedRequest,
  }

  if (effectiveType === 'timed' && effectiveDuration) {
    extra.expires_at = now + effectiveDuration
  }

  await store.updateStatus(grantId, 'approved', extra)
  const updated = await store.findById(grantId)
  return updated!
}

/**
 * Deny a grant.
 */
export async function denyGrant(
  grantId: string,
  denier: string,
  store: GrantStore,
): Promise<OpenApeGrant> {
  const grant = await store.findById(grantId)
  if (!grant) {
    throw new Error(`Grant not found: ${grantId}`)
  }
  if (grant.status !== 'pending') {
    throw new Error(`Grant is not pending: ${grant.status}`)
  }

  const now = Math.floor(Date.now() / 1000)
  await store.updateStatus(grantId, 'denied', {
    decided_by: denier,
    decided_at: now,
  })

  const updated = await store.findById(grantId)
  return updated!
}

/**
 * Revoke an approved grant (RFC 7009 style).
 */
export async function revokeGrant(
  grantId: string,
  store: GrantStore,
): Promise<OpenApeGrant> {
  const grant = await store.findById(grantId)
  if (!grant) {
    throw new Error(`Grant not found: ${grantId}`)
  }
  if (grant.status !== 'pending' && grant.status !== 'approved') {
    throw new Error(`Grant cannot be revoked (status: ${grant.status})`)
  }

  await store.updateStatus(grantId, 'revoked')

  const updated = await store.findById(grantId)
  return updated!
}

/**
 * Introspect a grant (RFC 7662 style).
 * Auto-expires timed grants that have passed their expiration.
 */
export async function introspectGrant(
  grantId: string,
  store: GrantStore,
): Promise<OpenApeGrant | null> {
  const grant = await store.findById(grantId)
  if (!grant) {
    return null
  }

  // Auto-expire timed grants that have passed their expiration
  if (
    grant.status === 'approved'
    && grant.request.grant_type === 'timed'
    && grant.expires_at
    && Math.floor(Date.now() / 1000) >= grant.expires_at
  ) {
    await store.updateStatus(grantId, 'expired')
    const updated = await store.findById(grantId)
    return updated!
  }

  return grant
}

/**
 * Use a grant.
 * For 'once' grants: marks as 'used' with used_at timestamp.
 * For 'timed'/'always' grants: verifies still valid and returns the grant.
 */
export async function useGrant(
  grantId: string,
  store: GrantStore,
): Promise<OpenApeGrant> {
  const grant = await introspectGrant(grantId, store)
  if (!grant) {
    throw new Error(`Grant not found: ${grantId}`)
  }
  if (grant.status !== 'approved') {
    throw new Error(`Grant is not approved: ${grant.status}`)
  }

  if (grant.request.grant_type === 'once') {
    const now = Math.floor(Date.now() / 1000)
    await store.updateStatus(grantId, 'used', { used_at: now })
    const updated = await store.findById(grantId)
    return updated!
  }

  // For 'timed' and 'always' grants, just return the valid grant
  return grant
}

/**
 * Create a delegation grant (pre-approved by the delegator).
 */
export async function createDelegation(
  params: {
    delegator: string
    delegate: string
    audience: string
    scopes?: string[]
    grant_type: GrantType
    duration?: number
  },
  store: GrantStore,
): Promise<OpenApeGrant> {
  const grant: OpenApeGrant = {
    id: crypto.randomUUID(),
    type: 'delegation',
    request: {
      requester: params.delegator,
      target_host: params.audience,
      audience: params.audience,
      grant_type: params.grant_type,
      delegator: params.delegator,
      delegate: params.delegate,
      scopes: params.scopes,
      duration: params.duration,
    },
    status: 'pending',
    created_at: Math.floor(Date.now() / 1000),
  }
  await store.save(grant)

  // Auto-approve since the delegator is creating it
  return approveGrant(grant.id, params.delegator, store)
}

function cliDetails(details?: unknown[]): OpenApeCliAuthorizationDetail[] {
  return (details ?? []).filter((d): d is OpenApeCliAuthorizationDetail =>
    typeof d === 'object' && d !== null && (d as Record<string, unknown>).type === 'openape_cli',
  )
}

/**
 * Approve a grant with extension: revokes specified old grants and modifies
 * the pending grant's authorization_details before approving.
 */
export async function approveGrantWithExtension(
  grantId: string,
  approver: string,
  store: GrantStore,
  overrides: ApproveGrantOverrides & Required<Pick<ApproveGrantOverrides, 'extend_mode' | 'extend_grant_ids'>>,
): Promise<OpenApeGrant> {
  const pendingGrant = await store.findById(grantId)
  if (!pendingGrant)
    throw new Error(`Grant not found: ${grantId}`)
  if (pendingGrant.status !== 'pending')
    throw new Error(`Grant is not pending: ${pendingGrant.status}`)

  const oldGrants: OpenApeGrant[] = []
  for (const oldId of overrides.extend_grant_ids) {
    const old = await store.findById(oldId)
    if (!old)
      throw new Error(`Extend grant not found: ${oldId}`)
    if (old.status !== 'approved')
      throw new Error(`Extend grant is not approved: ${old.status}`)
    if (old.request.target_host !== pendingGrant.request.target_host)
      throw new Error(`Extend grant target_host mismatch`)
    if (old.request.audience !== pendingGrant.request.audience)
      throw new Error(`Extend grant audience mismatch`)
    oldGrants.push(old)
  }

  const pendingCliDetails = cliDetails(pendingGrant.request.authorization_details)
  let newDetails: OpenApeCliAuthorizationDetail[]

  if (overrides.extend_mode === 'widen') {
    const allOldDetails = oldGrants.flatMap(g => cliDetails(g.request.authorization_details))
    const widened: OpenApeCliAuthorizationDetail[] = [...pendingCliDetails]
    for (const existingDetail of allOldDetails) {
      for (const incomingDetail of pendingCliDetails) {
        if (cliAuthorizationDetailIsSimilar(existingDetail, incomingDetail)) {
          widened.push(widenCliAuthorizationDetail(existingDetail, incomingDetail))
        }
      }
    }
    newDetails = mergeCliAuthorizationDetails(widened)
  }
  else {
    newDetails = mergeCliAuthorizationDetails(
      pendingCliDetails,
      ...oldGrants.map(g => cliDetails(g.request.authorization_details)),
    )
  }

  // Update the pending grant's request with the new authorization details
  const modifiedRequest: OpenApeGrantRequest = {
    ...pendingGrant.request,
    authorization_details: newDetails,
    permissions: newDetails.map(d => canonicalizeCliPermission(d)),
    // Clear command/cmd_hash when widening — the original narrow command no longer
    // represents the broader scope of the extended grant
    ...(overrides.extend_mode === 'widen' ? { command: undefined, cmd_hash: undefined } : {}),
  }
  await store.updateStatus(grantId, 'pending', { request: modifiedRequest })

  // Revoke old grants
  for (const old of oldGrants) {
    await revokeGrant(old.id, store)
  }

  // Approve the modified pending grant
  return approveGrant(grantId, approver, store, {
    grant_type: overrides.grant_type,
    duration: overrides.duration,
  })
}

/**
 * Validate a delegation grant for use by the delegate.
 * Returns the grant if valid, throws otherwise.
 */
export async function validateDelegation(
  grantId: string,
  delegate: string,
  audience: string,
  store: GrantStore,
): Promise<OpenApeGrant> {
  const grant = await introspectGrant(grantId, store)
  if (!grant) {
    throw new Error(`Delegation grant not found: ${grantId}`)
  }

  if (grant.type !== 'delegation') {
    throw new Error('Not a delegation grant')
  }

  if (grant.status !== 'approved') {
    throw new Error(`Delegation grant is not approved: ${grant.status}`)
  }

  if (grant.request.delegate !== delegate) {
    throw new Error('Delegate does not match')
  }

  if (grant.request.audience !== '*' && grant.request.audience !== audience) {
    throw new Error('Audience does not match')
  }

  return grant
}
