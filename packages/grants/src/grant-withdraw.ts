import type { OpenApeGrantWithdrawResult } from '@openape/core'
import { parseGrantReference } from './grant-reference.js'
import type { GrantStore } from './stores.js'

/** A withdrawal request that violates grants.md §4.11; callers answer it with 400. */
export class InvalidGrantWithdrawError extends Error {}

export function parseGrantWithdrawReason(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim() || [...value].length > 500 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value))
    throw new InvalidGrantWithdrawError('reason must be 1–500 characters without control or format characters')
  return value
}

/** Body of `POST /api/grants/withdraw`: exactly a reference and an optional reason. */
export function parseGrantWithdrawRequest(input: unknown): { reference: string, reason?: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InvalidGrantWithdrawError('A JSON object with a reference is required')
  const body = input as Record<string, unknown>
  if (Object.keys(body).some(key => key !== 'reference' && key !== 'reason')) throw new InvalidGrantWithdrawError('Only reference and reason are allowed')
  let reference: string | undefined
  try { reference = parseGrantReference(body.reference) }
  catch (error) { throw new InvalidGrantWithdrawError((error as Error).message) }
  if (reference === undefined) throw new InvalidGrantWithdrawError('A reference is required')
  const reason = parseGrantWithdrawReason(body.reason)
  return { reference, ...(reason !== undefined ? { reason } : {}) }
}

/**
 * Withdraws the requester's own referenced request (grants.md §4.11). The
 * caller resolves `referenceKey` from the authenticated requester and its
 * broker binding, so other requesters' requests are never addressable.
 */
export async function withdrawReferencedGrant(referenceKey: string, reason: string | undefined, store: GrantStore): Promise<OpenApeGrantWithdrawResult> {
  if (!store.withdraw) throw new Error('This store does not support withdrawing grants')
  const find = async () => (await store.listGrants({ referenceKey, limit: 1 })).data[0]
  let grant = await find()
  if (!grant) return { outcome: 'unknown' }
  const previous = grant.status === 'pending' || grant.status === 'approved' ? await store.withdraw(grant.id, Math.floor(Date.now() / 1000), reason) : null
  if (previous) return { outcome: 'withdrawn', grant_id: grant.id, previous_status: previous }
  // Another decision or the token issue may have landed first; report the state that won.
  grant = (await find())!
  if (grant.status === 'withdrawn') return { outcome: 'withdrawn', grant_id: grant.id, previous_status: 'withdrawn' }
  if (grant.status === 'denied' || grant.status === 'revoked' || grant.status === 'expired' || grant.status === 'used')
    return { outcome: 'already_decided', grant_id: grant.id, status: grant.status }
  throw new Error(`Grant could not be withdrawn (status: ${grant.status})`)
}

/** Strict reader for a withdrawal answer relayed by a broker or returned to a client. */
export function parseGrantWithdrawResult(value: unknown): OpenApeGrantWithdrawResult {
  const answer = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>
  const id = typeof answer.grant_id === 'string' && answer.grant_id.length > 0 && answer.grant_id.length <= 256 ? answer.grant_id : undefined
  const keys = Object.keys(answer).sort().join()
  if (answer.outcome === 'unknown' && keys === 'outcome') return { outcome: 'unknown' }
  if (answer.outcome === 'withdrawn' && id && keys === 'grant_id,outcome,previous_status' && (answer.previous_status === 'pending' || answer.previous_status === 'approved' || answer.previous_status === 'withdrawn'))
    return { outcome: 'withdrawn', grant_id: id, previous_status: answer.previous_status }
  if (answer.outcome === 'already_decided' && id && keys === 'grant_id,outcome,status' && (answer.status === 'denied' || answer.status === 'revoked' || answer.status === 'expired' || answer.status === 'used'))
    return { outcome: 'already_decided', grant_id: id, status: answer.status }
  throw new InvalidGrantWithdrawError('Invalid grant withdrawal answer')
}
