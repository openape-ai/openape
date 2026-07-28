import { describe, expect, it } from 'vitest'
import { isDue } from '../server/utils/cockpit/schedule'
import type { Schedule } from '../server/utils/cockpit/schedule'

// 2026-07-09 is summer (Vienna = UTC+2): 10:00Z = 12:00 Vienna.
const noonV = Date.UTC(2026, 6, 9, 10, 0, 0) // 12:00 Vienna
const earlyV = Date.UTC(2026, 6, 9, 4, 0, 0) // 06:00 Vienna
const eightV = Date.UTC(2026, 6, 9, 6, 0, 0) // 08:00 Vienna

// Fill the fields under test; the rest default to "unset".
const mk = (p: Partial<Schedule>): Schedule => ({ atHour: null, everyMinutes: null, fireAt: null, cronExpr: null, enabled: true, lastRunAt: null, createdAt: 0, ...p })

describe('isDue — daily (atHour, Vienna)', () => {
  it('not due before atHour', () => {
    expect(isDue(mk({ atHour: 8 }), earlyV)).toBe(false)
  })
  it('due after atHour when never run', () => {
    expect(isDue(mk({ atHour: 8 }), noonV)).toBe(true)
  })
  it('not due again once run today', () => {
    expect(isDue(mk({ atHour: 8, lastRunAt: Date.UTC(2026, 6, 9, 7, 0, 0) }), noonV)).toBe(false)
  })
  it('due again the next day', () => {
    expect(isDue(mk({ atHour: 8, lastRunAt: Date.UTC(2026, 6, 8, 7, 0, 0) }), noonV)).toBe(true)
  })
  it('disabled is never due', () => {
    expect(isDue(mk({ atHour: 8, enabled: false }), noonV)).toBe(false)
  })
})

describe('isDue — periodic (everyMinutes)', () => {
  it('due when never run', () => {
    expect(isDue(mk({ everyMinutes: 30 }), noonV)).toBe(true)
  })
  it('not due before the interval elapses', () => {
    expect(isDue(mk({ everyMinutes: 30, lastRunAt: noonV - 10 * 60_000 }), noonV)).toBe(false)
  })
  it('due after the interval elapses', () => {
    expect(isDue(mk({ everyMinutes: 30, lastRunAt: noonV - 31 * 60_000 }), noonV)).toBe(true)
  })
})

describe('isDue — one-shot timer (fireAt)', () => {
  it('not due before the target time', () => {
    expect(isDue(mk({ fireAt: noonV + 60_000 }), noonV)).toBe(false)
  })
  it('due once the target time has passed', () => {
    expect(isDue(mk({ fireAt: noonV - 1 }), noonV)).toBe(true)
  })
  it('never due again once fired (lastRunAt set)', () => {
    expect(isDue(mk({ fireAt: noonV - 60_000, lastRunAt: noonV - 30_000 }), noonV)).toBe(false)
  })
})

describe('isDue — cron expression (Vienna)', () => {
  it('daily 0 8 * * * is due after 08:00 when never run', () => {
    expect(isDue(mk({ cronExpr: '0 8 * * *', createdAt: earlyV }), noonV)).toBe(true)
  })
  it('not due again the same day once fired', () => {
    expect(isDue(mk({ cronExpr: '0 8 * * *', lastRunAt: eightV + 1 }), noonV)).toBe(false)
  })
  it('evening 0 20 * * * is not due at noon', () => {
    expect(isDue(mk({ cronExpr: '0 20 * * *', createdAt: earlyV }), noonV)).toBe(false)
  })
  it('an invalid cron expression is never due', () => {
    expect(isDue(mk({ cronExpr: 'not a cron', createdAt: earlyV }), noonV)).toBe(false)
  })
  it('disabled cron is never due', () => {
    expect(isDue(mk({ cronExpr: '0 8 * * *', createdAt: earlyV, enabled: false }), noonV)).toBe(false)
  })
})
