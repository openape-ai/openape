import type { OpenApeGrant } from '@openape/core'
import type { CompactCommand } from './command-structure'
import { distinctCompactCommands } from './command-structure'
import type { BindingLine, CardLanguage, GrantWithCard } from './grant-card'
import { grantBindingLine, requesterHeadline } from './grant-card'
import { grantSummaryView } from './grant-summary'

export interface GrantBatchRow {
  id: string
  grant: GrantWithCard
  description: string | null
  /** The complete technical binding used for stable ordering and inspection. */
  line: BindingLine
  /** The validated requester title, independent of the binding kind. */
  headline: string | null
  /** Short form of an exact command's line, distinct from the other rows; null shows `line.text` as it is. */
  compact: CompactCommand | null
  /** The member's own summary title as a labeled claim, when it is not already the headline. */
  claim: string | null
  status: OpenApeGrant['status']
  decidable: boolean
  /** When the member was used, decided or expired; null when no time is recorded. */
  decidedAt: number | null
}

export interface GrantBatchOperation {
  id: string
  action: 'approve' | 'deny'
}

/**
 * Rows in submission order; members submitted within the same second sort by
 * their binding line, which keeps the list stable and groups equal commands.
 * Only pending once-grants with the batch's scope can be decided together;
 * anything else needs its single approval view.
 */
export function grantBatchRows(members: GrantWithCard[], language: CardLanguage): GrantBatchRow[] {
  const scope = grantBatchScope(members)
  const uniform = (grant: OpenApeGrant) => (grant.request.grant_type ?? 'once') === 'once' && !grant.request.run_as && !grant.request.delegate && !grant.request.delegator && !grant.request.scopes && grant.request.audience === scope?.audience && grant.request.target_host === scope?.targetHost
  const ordered = members
    .map(grant => ({ grant, line: grantBindingLine(grant, language) }))
    .toSorted((a, b) => a.grant.created_at - b.grant.created_at || a.line.text.localeCompare(b.line.text))
  // Short forms only need to tell apart the rows shown together: open members, and the history.
  const compacts = new Map([true, false].flatMap((open) => {
    const shown = ordered.filter(({ grant }) => (grant.status === 'pending') === open)
    return distinctCompactCommands(shown.map(({ line }) => line.structure)).map((compact, index) => [shown[index]!.grant.id, compact] as const)
  }))
  return ordered.map(({ grant, line }) => {
    const headline = requesterHeadline(grant, line)
    return { id: grant.id, grant, description: grantSummaryView(grant.request.summary)?.description ?? null, line, headline, compact: compacts.get(grant.id) ?? null, claim: null, status: grant.status, decidable: grant.status === 'pending' && uniform(grant), decidedAt: grant.used_at ?? grant.decided_at ?? grant.expires_at ?? null }
  })
}

export interface GrantBatchSections {
  /** Pending members decided together on the batch page, in submission order. */
  open: GrantBatchRow[]
  /** Pending members that need their single approval view. */
  separate: GrantBatchRow[]
  /** Members no longer pending, newest first (by use, decision or expiry, then submission). */
  decided: GrantBatchRow[]
}

/** Only open members take part in the decision; everything else is history. */
export function grantBatchSections(rows: GrantBatchRow[]): GrantBatchSections {
  const latest = (row: GrantBatchRow) => row.decidedAt ?? 0
  return {
    open: rows.filter(row => row.decidable),
    separate: rows.filter(row => row.status === 'pending' && !row.decidable),
    decided: rows.filter(row => row.status !== 'pending').toReversed().toSorted((a, b) => latest(b) - latest(a)),
  }
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
export function grantBatchInfo(members: OpenApeGrant[]): { title: string | null, description: string | null, size: number | null, missing: number, waitsUntil: number | null } {
  const first = members.toSorted((a, b) => a.created_at - b.created_at)[0]
  const size = first?.request.batch?.size ?? null
  return {
    title: first?.request.batch?.title ?? null,
    description: first?.request.batch?.description ?? null,
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
  grant: GrantWithCard
  requester: string
  batchId: string
  title: string | null
  description: string | null
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
    batches.set(key, { grant, requester: grant.request.requester, batchId: batch.id, title: batch.title ?? null, description: batch.description ?? null, count: 1, size: batch.size ?? null, createdAt: grant.created_at })
  }
  return { batches: [...batches.values()].toSorted((a, b) => b.createdAt - a.createdAt), singles }
}
