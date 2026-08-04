import type { BoardTask, Lane } from '../app/utils/board'
import { describe, expect, it } from 'vitest'
import {
  callerRole,
  dueLabel,
  effectiveLaneId,
  laneCounts,
  laneTasks,
  localInputToUnix,
  remindPresetDate,
  unixToLocalInput,
} from '../app/utils/board'

const LANES: Lane[] = [
  { id: 'backlog', name: 'Backlog', status: 'open' },
  { id: 'doing', name: 'Doing', status: 'doing' },
  { id: 'done', name: 'Done', status: 'done' },
]

function task(overrides: Partial<BoardTask> = {}): BoardTask {
  return { status: 'open', lane_id: null, sort_order: 0, created_at: 0, completed_at: null, ...overrides }
}

describe('effectiveLaneId', () => {
  it('keeps an explicit, still-valid lane', () => {
    expect(effectiveLaneId(task({ lane_id: 'doing' }), LANES)).toBe('doing')
  })

  it('falls back to the first lane of the status bucket when the lane is gone', () => {
    expect(effectiveLaneId(task({ lane_id: 'deleted-lane', status: 'doing' }), LANES)).toBe('doing')
    expect(effectiveLaneId(task({ lane_id: null, status: 'open' }), LANES)).toBe('backlog')
  })

  it('buckets archived tasks as done', () => {
    expect(effectiveLaneId(task({ status: 'archived' }), LANES)).toBe('done')
  })

  it('falls back to the first lane when no lane matches the bucket', () => {
    const noDone: Lane[] = [{ id: 'only', name: 'Only', status: 'open' }]
    expect(effectiveLaneId(task({ status: 'done' }), noDone)).toBe('only')
    expect(effectiveLaneId(task(), [])).toBe('')
  })
})

describe('laneCounts', () => {
  it('counts visible tasks per lane and hides archived', () => {
    const tasks = [
      task(),
      task({ lane_id: 'backlog' }),
      task({ status: 'doing' }),
      task({ status: 'archived' }),
    ]
    expect(laneCounts(tasks, LANES)).toEqual({ backlog: 2, doing: 1, done: 0 })
  })
})

describe('laneTasks', () => {
  it('orders normal lanes by sort_order, ties by created_at', () => {
    const a = task({ sort_order: 2, created_at: 1 })
    const b = task({ sort_order: 1, created_at: 9 })
    const c = task({ sort_order: 1, created_at: 3 })
    expect(laneTasks([a, b, c], LANES, 'backlog')).toEqual([c, b, a])
  })

  it('orders done lanes newest-completed-first and excludes archived', () => {
    const oldDone = task({ status: 'done', completed_at: 100 })
    const newDone = task({ status: 'done', completed_at: 200 })
    const archived = task({ status: 'archived', completed_at: 300 })
    expect(laneTasks([oldDone, newDone, archived], LANES, 'done')).toEqual([newDone, oldDone])
  })
})

describe('callerRole', () => {
  const members = [{ email: 'own@x.y', role: 'owner' as const }, { email: 'ed@x.y', role: 'editor' as const }]

  it('finds the member by email', () => {
    expect(callerRole(members, 'ed@x.y')).toBe('editor')
  })

  it('returns null for strangers and missing email', () => {
    expect(callerRole(members, 'ghost@x.y')).toBeNull()
    expect(callerRole(members, undefined)).toBeNull()
  })
})

describe('dueLabel', () => {
  const NOW = 1_785_800_000

  it('is empty without a timestamp', () => {
    expect(dueLabel(null, NOW)).toBeNull()
  })

  it('shows a clock time within 24 hours', () => {
    expect(dueLabel(NOW + 3600, NOW)).toMatch(/\d{1,2}[:.]\d{2}/)
  })

  it('labels the near future in days', () => {
    expect(dueLabel(NOW + 86400 * 2, NOW)).toBe('In 2d')
    expect(dueLabel(NOW + 86400 * 6, NOW)).toBe('In 6d')
  })

  it('labels the overdue past in days', () => {
    expect(dueLabel(NOW - 86400 * 3, NOW)).toBe('3d overdue')
  })

  it('falls back to a calendar date from a week out', () => {
    expect(dueLabel(NOW + 86400 * 30, NOW)).not.toMatch(/^In /)
  })
})

describe('datetime-local round-trip', () => {
  it('survives unix → input → unix (minute precision)', () => {
    const ts = 1_785_800_040 // some :34 minute mark
    const roundTripped = localInputToUnix(unixToLocalInput(ts))
    expect(Math.abs(roundTripped - ts)).toBeLessThan(60)
  })
})

describe('remindPresetDate', () => {
  // Tuesday 10:00 local time.
  const tuesdayMorning = new Date(2026, 7, 4, 10, 0, 0)

  it('plus-1h adds exactly one hour', () => {
    expect(remindPresetDate('plus-1h', tuesdayMorning).getTime() - tuesdayMorning.getTime()).toBe(3600_000)
  })

  it('today-evening lands on 18:00 today when that is still ahead', () => {
    const d = remindPresetDate('today-evening', tuesdayMorning)
    expect([d.getDate(), d.getHours()]).toEqual([4, 18])
  })

  it('today-evening never resolves into the past — after 18:00 it moves to tomorrow', () => {
    const lateEvening = new Date(2026, 7, 4, 20, 0, 0)
    const d = remindPresetDate('today-evening', lateEvening)
    expect([d.getDate(), d.getHours()]).toEqual([5, 18])
  })

  it('tomorrow-morning is 09:00 the next day', () => {
    const d = remindPresetDate('tomorrow-morning', tuesdayMorning)
    expect([d.getDate(), d.getHours()]).toEqual([5, 9])
  })

  it('next-week is the coming Monday 09:00', () => {
    const d = remindPresetDate('next-week', tuesdayMorning)
    expect([d.getDay(), d.getHours()]).toEqual([1, 9])
    expect(d.getTime()).toBeGreaterThan(tuesdayMorning.getTime())
  })

  it('next-week from a Monday jumps a full week, not to today', () => {
    const monday = new Date(2026, 7, 3, 10, 0, 0)
    const d = remindPresetDate('next-week', monday)
    expect(d.getDate()).toBe(10)
  })
})
