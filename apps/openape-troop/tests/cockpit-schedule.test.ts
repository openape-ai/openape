import { describe, expect, it } from 'vitest'
import { isDue } from '../server/utils/cockpit/schedule'

// 2026-07-09 is summer (Vienna = UTC+2): 10:00Z = 12:00 Vienna.
const noonV = Date.UTC(2026, 6, 9, 10, 0, 0) // 12:00 Vienna
const earlyV = Date.UTC(2026, 6, 9, 4, 0, 0) // 06:00 Vienna

describe('isDue — daily (atHour, Vienna)', () => {
  it('not due before atHour', () => {
    expect(isDue({ atHour: 8, everyMinutes: null, fireAt: null, enabled: true, lastRunAt: null }, earlyV)).toBe(false)
  })
  it('due after atHour when never run', () => {
    expect(isDue({ atHour: 8, everyMinutes: null, fireAt: null, enabled: true, lastRunAt: null }, noonV)).toBe(true)
  })
  it('not due again once run today', () => {
    const ranToday = Date.UTC(2026, 6, 9, 7, 0, 0) // 09:00 Vienna, same day
    expect(isDue({ atHour: 8, everyMinutes: null, fireAt: null, enabled: true, lastRunAt: ranToday }, noonV)).toBe(false)
  })
  it('due again the next day', () => {
    const ranYesterday = Date.UTC(2026, 6, 8, 7, 0, 0)
    expect(isDue({ atHour: 8, everyMinutes: null, fireAt: null, enabled: true, lastRunAt: ranYesterday }, noonV)).toBe(true)
  })
  it('disabled is never due', () => {
    expect(isDue({ atHour: 8, everyMinutes: null, fireAt: null, enabled: false, lastRunAt: null }, noonV)).toBe(false)
  })
})

describe('isDue — periodic (everyMinutes)', () => {
  it('due when never run', () => {
    expect(isDue({ atHour: null, everyMinutes: 30, fireAt: null, enabled: true, lastRunAt: null }, noonV)).toBe(true)
  })
  it('not due before the interval elapses', () => {
    expect(isDue({ atHour: null, everyMinutes: 30, fireAt: null, enabled: true, lastRunAt: noonV - 10 * 60_000 }, noonV)).toBe(false)
  })
  it('due after the interval elapses', () => {
    expect(isDue({ atHour: null, everyMinutes: 30, fireAt: null, enabled: true, lastRunAt: noonV - 31 * 60_000 }, noonV)).toBe(true)
  })
})

describe('isDue — one-shot timer (fireAt)', () => {
  it('not due before the target time', () => {
    expect(isDue({ atHour: null, everyMinutes: null, fireAt: noonV + 60_000, enabled: true, lastRunAt: null }, noonV)).toBe(false)
  })
  it('due once the target time has passed', () => {
    expect(isDue({ atHour: null, everyMinutes: null, fireAt: noonV - 1, enabled: true, lastRunAt: null }, noonV)).toBe(true)
  })
  it('due exactly at the target time', () => {
    expect(isDue({ atHour: null, everyMinutes: null, fireAt: noonV, enabled: true, lastRunAt: null }, noonV)).toBe(true)
  })
  it('never due again once fired (lastRunAt set)', () => {
    expect(isDue({ atHour: null, everyMinutes: null, fireAt: noonV - 60_000, enabled: true, lastRunAt: noonV - 30_000 }, noonV)).toBe(false)
  })
  it('disabled timer is never due', () => {
    expect(isDue({ atHour: null, everyMinutes: null, fireAt: noonV - 1, enabled: false, lastRunAt: null }, noonV)).toBe(false)
  })
})
