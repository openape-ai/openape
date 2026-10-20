import type { OpenApeGrant } from '@openape/core'
import type { GrantStore } from '@openape/grants'

/** Approval page of a grant; a batch member opens its batch so the owner decides all members at once. */
export function grantApprovalPath(grant: OpenApeGrant): string {
  const batch = grant.request.batch
  if (!batch) return `/grant-approval?grant_id=${encodeURIComponent(grant.id)}`
  return `/grant-approval?${new URLSearchParams({ requester: grant.request.requester, batch: batch.id })}`
}

/** The earliest still-pending member announces this collection; completed history never suppresses new work. */
export async function isFollowUpBatchMember(grant: OpenApeGrant, store: Pick<GrantStore, 'listGrants'>): Promise<boolean> {
  const batch = grant.request.batch
  if (!batch) return false
  let cursor: string | undefined
  do {
    const page = await store.listGrants({ requester: grant.request.requester, requesterFilter: grant.request.requester, batch: batch.id, status: 'pending', limit: 100, cursor })
    if (page.data.some(member => member.brokered?.owner === grant.brokered?.owner && (member.created_at < grant.created_at || (member.created_at === grant.created_at && member.id < grant.id)))) return true
    if (!page.pagination.has_more) return false
    if (!page.pagination.cursor || page.pagination.cursor === cursor) throw new Error('Pending batch pagination did not advance')
    cursor = page.pagination.cursor
  } while (cursor)
  return false
}
