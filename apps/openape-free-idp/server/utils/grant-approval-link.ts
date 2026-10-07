import type { OpenApeGrant } from '@openape/core'
import type { GrantStore } from '@openape/grants'

/** Approval page of a grant; a batch member opens its batch so the owner decides all members at once. */
export function grantApprovalPath(grant: OpenApeGrant): string {
  const batch = grant.request.batch
  if (!batch) return `/grant-approval?grant_id=${encodeURIComponent(grant.id)}`
  return `/grant-approval?${new URLSearchParams({ requester: grant.request.requester, batch: batch.id })}`
}

/** One notification announces a batch: every member after the first stays quiet. */
export async function isFollowUpBatchMember(grant: OpenApeGrant, store: Pick<GrantStore, 'listGrants'>): Promise<boolean> {
  const batch = grant.request.batch
  if (!batch) return false
  const { data } = await store.listGrants({ requester: grant.request.requester, requesterFilter: grant.request.requester, batch: batch.id, limit: 2 })
  return data.some(member => member.id !== grant.id)
}
