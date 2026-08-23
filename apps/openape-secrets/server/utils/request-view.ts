import type { InferSelectModel } from 'drizzle-orm'
import type { secretRequests } from '../database/schema'

export type SecretRequestRow = InferSelectModel<typeof secretRequests>

/**
 * The public shape of a request. Note what is missing: the four `box_*`
 * columns. Nobody reads a sealed envelope through this API — not a stranger,
 * not the requester, not even the owner who filled it. Only the consumer
 * collects it, once, through its own endpoint (M4).
 *
 * Building the view here rather than at each call site is deliberate: a
 * `select()` that accidentally spreads the whole row is exactly how ciphertext
 * leaks into a listing, and there is no second line of defence for that.
 */
export function toRequestView(r: SecretRequestRow) {
  return {
    id: r.id,
    owner: r.ownerEmail,
    requester: r.requester,
    consumer_id: r.consumerId,
    field_name: r.fieldName,
    purpose: r.purpose,
    status: r.status,
    expires_at: r.expiresAt,
    created_at: r.createdAt,
    filled_at: r.filledAt,
    fetched_at: r.fetchedAt,
  }
}

/** A request that nobody filled in time is dead, whatever the row still says. */
export function isLapsed(r: Pick<SecretRequestRow, 'status' | 'expiresAt'>, nowSec: number): boolean {
  return r.status === 'requested' && nowSec >= r.expiresAt
}
