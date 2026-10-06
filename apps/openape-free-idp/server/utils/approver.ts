import type { OpenApeGrant } from '@openape/core'
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
export async function resolveApprover(requester: string, grant?: OpenApeGrant): Promise<string | null> {
  const row = await useDb()
    .select()
    .from(users)
    .where(eq(users.email, grant?.brokered?.owner ?? requester))
    .get()
  if (!row || !row.isActive) return null
  if (grant?.brokered) return row.type !== 'agent' && !row.owner ? row.email : null
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
    const binding = JSON.stringify([requester, grant.brokered?.owner, grant.brokered?.connection_id])
    if (!approverByRequester.has(binding)) {
      approverByRequester.set(binding, await resolveApprover(requester, grant))
    }
    if (approverByRequester.get(binding) === approver) count++
  }
  return count
}
