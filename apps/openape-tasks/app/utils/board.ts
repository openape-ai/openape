/**
 * Pure board logic, extracted from `pages/teams/[id]/index.vue` so it is
 * testable without mounting the page (issue #1172). The page keeps only
 * state and wiring; every branch that can be wrong lives here.
 */

export type LaneStatus = 'open' | 'doing' | 'done'
export interface Lane { id: string, name: string, status: LaneStatus }

export type TaskStatus = 'open' | 'doing' | 'done' | 'archived'
export interface BoardTask {
  status: TaskStatus
  lane_id: string | null
  sort_order: number
  created_at: number
  completed_at: number | null
}

export interface TeamMember { email: string, role: 'owner' | 'editor' | 'viewer' }

/**
 * Mirror of server/utils/lanes.ts effectiveLaneId: an explicit, still-valid
 * lane wins; otherwise a task falls into the first lane of its status bucket.
 */
export function effectiveLaneId(task: Pick<BoardTask, 'status' | 'lane_id'>, lanes: Lane[]): string {
  if (task.lane_id && lanes.some(l => l.id === task.lane_id)) return task.lane_id
  const bucket: LaneStatus = task.status === 'archived' ? 'done' : task.status
  const match = lanes.find(l => l.status === bucket) ?? lanes[0]
  return match?.id ?? ''
}

/** Visible task count per lane; archived tasks are hidden from the board. */
export function laneCounts(tasks: BoardTask[], lanes: Lane[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const l of lanes) counts[l.id] = 0
  for (const t of tasks) {
    if (t.status === 'archived') continue
    const id = effectiveLaneId(t, lanes)
    if (id in counts) counts[id] = (counts[id] ?? 0) + 1
  }
  return counts
}

/**
 * The tasks of one lane, in display order: done lanes read newest-completed-
 * first, all others by manual order (ties broken by creation time).
 */
export function laneTasks<T extends BoardTask>(tasks: T[], lanes: Lane[], laneId: string): T[] {
  const isDone = lanes.find(l => l.id === laneId)?.status === 'done'
  return tasks
    .filter(t => t.status !== 'archived' && effectiveLaneId(t, lanes) === laneId)
    .sort((a, b) => {
      if (isDone) return (b.completed_at ?? 0) - (a.completed_at ?? 0)
      return a.sort_order - b.sort_order || a.created_at - b.created_at
    })
}

export function callerRole(members: TeamMember[], email: string | undefined): TeamMember['role'] | null {
  if (!email) return null
  return members.find(m => m.email === email)?.role ?? null
}

/** Human due/remind label: relative inside a week, clock time inside a day. */
export function dueLabel(ts: number | null, nowSeconds: number = Math.floor(Date.now() / 1000)): string | null {
  if (!ts) return null
  const diff = ts - nowSeconds
  const absH = Math.abs(diff) / 3600
  if (absH < 24) {
    const d = new Date(ts * 1000)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  const days = Math.round(diff / 86400)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days < 7) return `In ${days}d`
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// <input type="datetime-local"> helpers. The input's value is a naive string
// in the user's local timezone; we round-trip via Date which applies local TZ.
export function unixToLocalInput(ts: number): string {
  const d = new Date(ts * 1000)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export function localInputToUnix(s: string): number {
  return Math.floor(new Date(s).getTime() / 1000)
}

/**
 * Remind presets, modeled after iOS Reminders' date popover (Heute Abend /
 * Morgen früh / Nächste Woche). All anchors are computed in the caller's
 * local timezone — Date constructor with year/month/day/hour applies local
 * TZ implicitly.
 */
export type RemindPreset = 'plus-1h' | 'today-evening' | 'tomorrow-morning' | 'next-week'

export function remindPresetDate(preset: RemindPreset, now: Date = new Date()): Date {
  switch (preset) {
    case 'plus-1h':
      return new Date(now.getTime() + 3600_000)
    case 'today-evening': {
      const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0)
      // If it's already past 18:00, push to tomorrow evening so the preset
      // never resolves into the past.
      if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1)
      }
      return target
    }
    case 'tomorrow-morning':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0)
    case 'next-week': {
      // Next Monday 09:00 (local). getDay() = 0..6 with 0=Sunday.
      const daysUntilMonday = ((1 - now.getDay() + 7) % 7) || 7
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilMonday, 9, 0, 0)
    }
  }
}
