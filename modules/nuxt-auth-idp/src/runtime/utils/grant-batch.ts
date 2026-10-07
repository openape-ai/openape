import type { OpenApeGrant } from '@openape/core'

export interface GrantBatchRow {
  id: string
  label: string
  status: OpenApeGrant['status']
  decidable: boolean
}

export interface GrantBatchOperation {
  id: string
  action: 'approve' | 'deny'
}

/** The member's own one-line description: first summary line, else its command or permissions. */
export function grantBatchRowLabel(grant: OpenApeGrant): string {
  const line = grant.request.summary?.text?.split('\n').map(part => part.trim()).find(Boolean)
  if (line) return line
  if (grant.request.command?.length) return grant.request.command.join(' ')
  if (grant.request.permissions?.length) return grant.request.permissions.join(', ')
  return grant.id
}

/**
 * Rows in submission order; members submitted within the same second sort by
 * label, which keeps the list stable and groups equal senders. Only pending
 * once-grants with the batch's scope can be decided together; anything else
 * needs its single approval view.
 */
export function grantBatchRows(members: OpenApeGrant[]): GrantBatchRow[] {
  const scope = grantBatchScope(members)
  const uniform = (grant: OpenApeGrant) => (grant.request.grant_type ?? 'once') === 'once' && !grant.request.run_as && !grant.request.delegate && grant.request.audience === scope?.audience && grant.request.target_host === scope?.targetHost
  return members
    .map(grant => ({ grant, row: { id: grant.id, label: grantBatchRowLabel(grant), status: grant.status, decidable: grant.status === 'pending' && uniform(grant) } }))
    .toSorted((a, b) => a.grant.created_at - b.grant.created_at || a.row.label.localeCompare(b.row.label))
    .map(({ row }) => row)
}

/** Selected decidable members are approved, every other decidable member is denied. */
export function grantBatchOperations(rows: GrantBatchRow[], selected: ReadonlySet<string>): GrantBatchOperation[] {
  return rows.filter(row => row.decidable).map(row => ({ id: row.id, action: selected.has(row.id) ? 'approve' : 'deny' }))
}

/** Audience and target shared by the batch, taken from the earliest member. */
export function grantBatchScope(members: OpenApeGrant[]): { audience: string, targetHost: string } | null {
  const first = members.toSorted((a, b) => a.created_at - b.created_at)[0]
  return first ? { audience: first.request.audience, targetHost: first.request.target_host } : null
}

/** Title, announced size and missing count, taken from the earliest member. */
export function grantBatchInfo(members: OpenApeGrant[]): { title: string | null, size: number | null, missing: number, waitsUntil: number | null } {
  const first = members.toSorted((a, b) => a.created_at - b.created_at)[0]
  const size = first?.request.batch?.size ?? null
  return {
    title: first?.request.batch?.title ?? null,
    size,
    missing: size === null ? 0 : Math.max(0, size - members.length),
    waitsUntil: first?.request.waits_until ?? null,
  }
}

/** Approval link for a batch; batch ids are scoped to their requester. */
export function grantBatchPath(requester: string, batchId: string): string {
  return `/grant-approval?${new URLSearchParams({ requester, batch: batchId }).toString()}`
}

export interface PendingGrantBatch {
  requester: string
  batchId: string
  title: string | null
  count: number
  size: number | null
  createdAt: number
}

/** Splits pending grants into batch cards (by requester and batch id) and individual grants. */
export function groupPendingGrantBatches(pending: OpenApeGrant[]): { batches: PendingGrantBatch[], singles: OpenApeGrant[] } {
  const batches = new Map<string, PendingGrantBatch>()
  const singles: OpenApeGrant[] = []
  for (const grant of pending) {
    const batch = grant.request.batch
    if (!batch) { singles.push(grant); continue }
    const key = JSON.stringify([grant.request.requester, batch.id])
    const existing = batches.get(key)
    if (existing) {
      existing.count++
      existing.createdAt = Math.max(existing.createdAt, grant.created_at)
      continue
    }
    batches.set(key, { requester: grant.request.requester, batchId: batch.id, title: batch.title ?? null, count: 1, size: batch.size ?? null, createdAt: grant.created_at })
  }
  return { batches: [...batches.values()].toSorted((a, b) => b.createdAt - a.createdAt), singles }
}
