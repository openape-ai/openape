import type { GrantType, OpenApeGrant, OpenApeGrantRequest } from '@openape/core'
import type { GrantStore } from './stores.js'

export interface ApproveGrantOverrides {
  grant_type?: GrantType
  duration?: number
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
