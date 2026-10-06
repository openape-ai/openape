import type { GrantStatus, OpenApeGrant } from '@openape/core'
import { isGrantExpired } from '@openape/grants'

interface StatusWriter {
  updateStatus: (id: string, status: GrantStatus) => Promise<void>
}

/**
 * grants.md §5: "If the grant is `approved`, has type `timed`, and
 * `expires_at` is in the past, the server MUST transition the grant to
 * `expired` before returning it."
 *
 * Introspection by id has always done that. Listings did not, so they served
 * dead grants as `approved` — and since nothing else ever touched those
 * grants, the stored status stayed wrong forever. `ensure-delegations` decides
 * whether to renew a delegation by reading such a list, which is why it would
 * not have renewed late on 19.09.; it would not have renewed at all (#1290).
 *
 * The write happens once per grant in its lifetime: afterwards the status no
 * longer qualifies, so later listings find nothing to do.
 */
export async function expireStaleGrants<T extends OpenApeGrant>(grants: T[], store: StatusWriter): Promise<T[]> {
  const stale = grants.filter(g => isGrantExpired(g))
  if (stale.length) {
    await Promise.all(stale.map(g => store.updateStatus(g.id, 'expired')))
  }
  const staleIds = new Set(stale.map(g => g.id))
  return grants.map(g => staleIds.has(g.id) ? { ...g, status: 'expired' as GrantStatus } : g)
}
