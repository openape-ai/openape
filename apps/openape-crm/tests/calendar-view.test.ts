import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  dayKey,
  eventsOnDay,
  formatBytes,
  monthGridDays,
  parseGraphDateTime,
  startOfMonth,
  startOfWeekMonday,
  weekDays,
} from '../shared/calendar-view'

describe('parseGraphDateTime', () => {
  it('treats bare Graph local times as UTC', () => {
    const d = parseGraphDateTime('2026-09-01T10:00:00')
    expect(d?.toISOString()).toBe('2026-09-01T10:00:00.000Z')
  })

  it('keeps explicit Z', () => {
    expect(parseGraphDateTime('2026-09-01T10:00:00Z')?.toISOString()).toBe('2026-09-01T10:00:00.000Z')
  })
})

describe('month and week grids', () => {
  it('starts weeks on Monday', () => {
    const monday = startOfWeekMonday(new Date('2026-08-27T12:00:00Z'))
    expect(dayKey(monday)).toBe('2026-08-24')
  })

  it('builds a 42-day month grid covering the anchor month', () => {
    const days = monthGridDays(new Date('2026-08-15T12:00:00Z'))
    expect(days).toHaveLength(42)
    expect(dayKey(days[0]!)).toBe('2026-07-27')
    expect(days.some(d => dayKey(d) === '2026-08-01')).toBe(true)
    expect(days.some(d => dayKey(d) === '2026-08-31')).toBe(true)
  })

  it('lists seven week days from Monday', () => {
    const days = weekDays(new Date('2026-08-27T12:00:00Z'))
    expect(days.map(dayKey)).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ])
  })

  it('shifts months', () => {
    expect(dayKey(startOfMonth(addMonths(new Date('2026-08-15T12:00:00Z'), 1)))).toBe('2026-09-01')
    expect(dayKey(addDays(new Date('2026-08-27T12:00:00Z'), 1))).toBe('2026-08-28')
  })
})

describe('eventsOnDay', () => {
  it('matches events whose start falls on the day', () => {
    const events = [
      { id: '1', subject: 'A', start: '2026-08-27T09:00:00', end: null },
      { id: '2', subject: 'B', start: '2026-08-28T09:00:00', end: null },
    ]
    expect(eventsOnDay(events, new Date('2026-08-27T12:00:00Z')).map(e => e.id)).toEqual(['1'])
  })
})

describe('formatBytes', () => {
  it('formats common sizes', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3 MB')
  })
})
