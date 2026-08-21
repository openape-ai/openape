import { eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { users } from '../database/schema'

/**
 * Who has to decide about a requester's grants: the explicit approver row if
 * there is one (agents get one at enroll time), else the requester approves
 * their own. No user row means nobody to notify.
 *
 * Shared by every leg of the grant-pending fan-out — push, mail, Telegram —
 * so a fourth channel cannot quietly disagree with the other three about who
 * the owner is.
 */
export async function resolveApprover(requester: string): Promise<string | null> {
  const row = await useDb()
    .select()
    .from(users)
    .where(eq(users.email, requester))
    .get()
  if (!row) return null
  return row.approver ?? row.email
}

/** How many grants are currently waiting on this approver. */
export async function countPendingForApprover(approver: string): Promise<number> {
  const { grantStore } = useGrantStores()
  const pending = await grantStore.findPending()
  const approverByRequester = new Map<string, string | null>()
  let count = 0
  for (const grant of pending) {
    const requester = grant.request.requester
    if (!approverByRequester.has(requester)) {
      approverByRequester.set(requester, await resolveApprover(requester))
    }
    if (approverByRequester.get(requester) === approver) count++
  }
  return count
}
