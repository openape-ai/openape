export type PlanStatus = 'draft' | 'active' | 'done' | 'archived'

export interface SortablePlan {
  status: PlanStatus
  updated_at: number
}

/** Badge colour per status — was duplicated in the team and the plan page. */
export function statusColor(status: PlanStatus): 'neutral' | 'primary' | 'success' | 'warning' {
  if (status === 'active') return 'primary'
  if (status === 'done') return 'success'
  if (status === 'archived') return 'warning'
  return 'neutral'
}

/** What is being worked on comes first; inside a status, the freshest first. */
const STATUS_ORDER: Record<PlanStatus, number> = { active: 0, draft: 1, done: 2, archived: 3 }

export function byStatusThenUpdated(a: SortablePlan, b: SortablePlan): number {
  const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  return byStatus !== 0 ? byStatus : b.updated_at - a.updated_at
}

/** Plans in flight, ready for display. */
export function currentPlans<T extends SortablePlan>(plans: T[]): T[] {
  return plans.filter(p => p.status === 'active' || p.status === 'draft').sort(byStatusThenUpdated)
}

/** Plans that are over — same order, so the history reads like the top list. */
export function historyPlans<T extends SortablePlan>(plans: T[]): T[] {
  return plans.filter(p => p.status === 'done' || p.status === 'archived').sort(byStatusThenUpdated)
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" — `now` is injectable so it is testable. */
export function formatRelative(ts: number, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const diff = nowSeconds - ts
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
