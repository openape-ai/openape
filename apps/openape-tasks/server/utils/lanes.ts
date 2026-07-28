import { ulid } from 'ulid'
import type { TaskStatus } from './task-shape'

/**
 * Lanes are the configurable board columns (Trello-light). They are an additive
 * refinement of the canonical `status` axis: every lane maps to exactly one
 * status bucket (`open` | `doing` | `done`). Moving a task to a lane also sets
 * its `status` to the lane's bucket, so the reminder worker, `done`, and
 * `list --status` all keep working off `status` unchanged.
 *
 * Lanes never map to `archived` — archived tasks are hidden from the board, the
 * same way deleted tasks are.
 */
export type LaneStatus = 'open' | 'doing' | 'done'

export interface Lane {
  id: string
  name: string
  status: LaneStatus
}

const LANE_STATUSES = new Set<LaneStatus>(['open', 'doing', 'done'])
const MAX_LANES = 12
const MAX_LANE_NAME = 40

/**
 * Default lanes for a team with no `lanes` configured: one per status bucket so
 * existing boards render exactly like before (Open / Doing / Done). Fixed ids so
 * a NULL-lanes team resolves to the same lane ids on every call.
 */
export const DEFAULT_LANES: Lane[] = [
  { id: 'lane_open', name: 'Open', status: 'open' },
  { id: 'lane_doing', name: 'Doing', status: 'doing' },
  { id: 'lane_done', name: 'Done', status: 'done' },
]

/** One-click preset for a dev-workflow board (set via the lane editor). */
export const DEV_WORKFLOW_LANES: Omit<Lane, 'id'>[] = [
  { name: 'Backlog', status: 'open' },
  { name: 'Ready', status: 'open' },
  { name: 'Doing', status: 'doing' },
  { name: 'Review', status: 'doing' },
  { name: 'Done', status: 'done' },
]

function isLane(item: unknown): item is Lane {
  if (!item || typeof item !== 'object') return false
  const r = item as Record<string, unknown>
  return typeof r.id === 'string'
    && typeof r.name === 'string'
    && typeof r.status === 'string'
    && LANE_STATUSES.has(r.status as LaneStatus)
}

/**
 * Parse a team's stored `lanes` JSON into a lane list, falling back to
 * DEFAULT_LANES for NULL / empty / malformed input. Defensive read — never
 * throws (the write path validates; this is the read path).
 */
export function resolveLanes(raw: string | null | undefined): Lane[] {
  if (!raw) return DEFAULT_LANES
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_LANES
    const lanes = parsed.filter(isLane).map(l => ({ id: l.id, name: l.name, status: l.status }))
    return lanes.length ? lanes : DEFAULT_LANES
  }
  catch {
    return DEFAULT_LANES
  }
}

/**
 * Validate untrusted lane input from a team PATCH. Throws a plain Error (the
 * caller turns it into a 400) on any violation. Preserves a client-supplied
 * `id` when present (so renaming/reordering keeps `task.lane_id` stable),
 * otherwise mints a ULID. Requires at least one `open` and one `done` lane so
 * create-defaults and the `done` shortcut always have a target.
 */
export function validateLanes(input: unknown): Lane[] {
  if (!Array.isArray(input)) throw new Error('lanes must be an array')
  if (input.length === 0) throw new Error('lanes must have at least one lane')
  if (input.length > MAX_LANES) throw new Error(`lanes must be ≤ ${MAX_LANES}`)

  const out: Lane[] = []
  const seenNames = new Set<string>()
  let hasOpen = false
  let hasDone = false

  for (const item of input) {
    if (!item || typeof item !== 'object') throw new Error('each lane must be an object')
    const r = item as Record<string, unknown>

    const name = typeof r.name === 'string' ? r.name.trim() : ''
    if (!name || name.length > MAX_LANE_NAME) throw new Error(`lane name must be 1–${MAX_LANE_NAME} chars`)
    const nameKey = name.toLowerCase()
    if (seenNames.has(nameKey)) throw new Error(`duplicate lane name "${name}"`)
    seenNames.add(nameKey)

    if (typeof r.status !== 'string' || !LANE_STATUSES.has(r.status as LaneStatus)) {
      throw new Error('lane status must be open|doing|done')
    }
    const status = r.status as LaneStatus

    const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : ulid()
    out.push({ id, name, status })
    if (status === 'open') hasOpen = true
    if (status === 'done') hasDone = true
  }

  if (!hasOpen) throw new Error('lanes must include at least one "open" lane')
  if (!hasDone) throw new Error('lanes must include at least one "done" lane')
  return out
}

/** Find a lane by id, or by case-insensitive name (for CLI `--lane <name|id>`). */
export function laneById(lanes: Lane[], idOrName: string): Lane | undefined {
  const needle = idOrName.trim()
  return lanes.find(l => l.id === needle)
    ?? lanes.find(l => l.name.toLowerCase() === needle.toLowerCase())
}

/**
 * Resolve the lane a task effectively sits in. An explicit `lane_id` that still
 * exists wins; otherwise the task falls into the first lane of its status
 * bucket (so old tasks with NULL `lane_id` land deterministically). Archived
 * tasks aren't shown on the board but still resolve to a stable lane.
 */
export function effectiveLaneId(lanes: Lane[], status: TaskStatus, laneId: string | null): string {
  if (laneId && lanes.some(l => l.id === laneId)) return laneId
  const bucket: LaneStatus = status === 'archived' ? 'done' : status
  const match = lanes.find(l => l.status === bucket) ?? lanes[0]
  return match?.id ?? DEFAULT_LANES[0]!.id
}

/** The lane the `done` shortcut moves a task to: the rightmost `done` lane. */
export function doneLaneId(lanes: Lane[]): string {
  const done = [...lanes].reverse().find(l => l.status === 'done')
  const fallback = lanes[lanes.length - 1]
  return (done ?? fallback)?.id ?? DEFAULT_LANES[2]!.id
}

/**
 * Resolve the lane to use when a task's `status` changes without an explicit
 * lane move. Keeps the current lane if its bucket already matches the new
 * status (so re-saving `status` doesn't yank a task across same-bucket lanes);
 * otherwise snaps to the bucket's canonical lane — the rightmost `done` lane
 * for done, the first lane otherwise.
 */
export function laneForStatus(lanes: Lane[], status: TaskStatus, currentLaneId: string | null): string {
  const bucket: LaneStatus = status === 'archived' ? 'done' : status
  const current = currentLaneId ? lanes.find(l => l.id === currentLaneId) : undefined
  if (current && current.status === bucket) return current.id
  if (bucket === 'done') return doneLaneId(lanes)
  const match = lanes.find(l => l.status === bucket) ?? lanes[0]
  return match?.id ?? DEFAULT_LANES[0]!.id
}
