import type { DayEntry } from '../app/utils/time'
import { describe, expect, it } from 'vitest'
import { fmt, hhmm, monthBounds, monthGrid, toEpoch, totalsByDay } from '../app/utils/time'

describe('fmt', () => {
  it('renders minutes, whole hours, and mixed durations', () => {
    expect(fmt(45)).toBe('45m')
    expect(fmt(120)).toBe('2h')
    expect(fmt(210)).toBe('3h30m')
    expect(fmt(0)).toBe('0m')
  })
})

describe('hhmm', () => {
  it('formats epoch seconds as UTC clock time', () => {
    expect(hhmm(Date.UTC(2026, 7, 4, 9, 30) / 1000)).toBe('09:30')
  })

  it('shows an em-dash when unset', () => {
    expect(hhmm(null)).toBe('—')
  })
})

describe('toEpoch', () => {
  it('combines date and H:MM into epoch seconds (UTC)', () => {
    expect(toEpoch('2026-08-04', '9:30')).toBe(Date.UTC(2026, 7, 4, 9, 30) / 1000)
    expect(toEpoch('2026-08-04', '09:30')).toBe(Date.UTC(2026, 7, 4, 9, 30) / 1000)
  })

  it('rejects malformed times and dates', () => {
    expect(toEpoch('2026-08-04', '930')).toBeNull()
    expect(toEpoch('2026-08-04', '9:3')).toBeNull()
    expect(toEpoch('not-a-date', '09:30')).toBeNull()
  })
})

describe('monthBounds', () => {
  it('spans the first to the last day, including leap years', () => {
    expect(monthBounds('2026-08')).toEqual({ first: '2026-08-01', last: '2026-08-31', y: 2026, m: 8 })
    expect(monthBounds('2028-02').last).toBe('2028-02-29')
  })
})

describe('monthGrid', () => {
  it('builds Monday-first weeks with null padding', () => {
    // August 2026 starts on a Saturday: five leading nulls.
    const weeks = monthGrid('2026-08')
    expect(weeks[0]!.map(c => c.date)).toEqual([null, null, null, null, null, '2026-08-01', '2026-08-02'])
    expect(weeks.every(w => w.length === 7)).toBe(true)
    const dates = weeks.flat().filter(c => c.date !== null)
    expect(dates).toHaveLength(31)
    expect(dates.at(-1)!.date).toBe('2026-08-31')
  })

  it('covers a month that starts on Monday without leading padding', () => {
    expect(monthGrid('2026-06')[0]![0]!.date).toBe('2026-06-01')
  })
})

describe('totalsByDay', () => {
  function entry(overrides: Partial<DayEntry>): DayEntry {
    return { entry_date: '2026-08-04', duration_minutes: 60, is_break: false, overlap: false, ...overrides }
  }

  it('sums work and breaks separately per day', () => {
    const map = totalsByDay([
      entry({ duration_minutes: 90 }),
      entry({ duration_minutes: 30, is_break: true }),
      entry({ entry_date: '2026-08-05', duration_minutes: 45 }),
    ])
    expect(map.get('2026-08-04')).toEqual({ work: 90, brk: 30, overlap: false })
    expect(map.get('2026-08-05')).toEqual({ work: 45, brk: 0, overlap: false })
  })

  it('flags a day as soon as one entry overlaps', () => {
    const map = totalsByDay([entry({}), entry({ overlap: true })])
    expect(map.get('2026-08-04')!.overlap).toBe(true)
  })
})
