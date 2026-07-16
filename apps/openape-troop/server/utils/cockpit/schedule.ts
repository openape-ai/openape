export interface Schedule { atHour: number | null, everyMinutes: number | null, fireAt: number | null, enabled: boolean, lastRunAt: number | null }

const TZ = 'Europe/Vienna'
function vienna(ms: number): { ymd: string, hour: number } {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return { ymd: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 }
}

// Is this schedule due at `nowMs`? Timer (fireAt): a one-shot, due once the
// target time has passed and it hasn't run yet (the evaluator disables it after).
// Daily (atHour): due once per Vienna-day, from atHour onward, until it has run
// today. Periodic (everyMinutes): due when at least that long has passed since
// the last run.
export function isDue(s: Schedule, nowMs: number): boolean {
  if (!s.enabled) return false
  if (s.fireAt != null) {
    return s.lastRunAt == null && nowMs >= s.fireAt
  }
  if (s.atHour != null) {
    const now = vienna(nowMs)
    if (now.hour < s.atHour) return false
    if (s.lastRunAt == null) return true
    return vienna(s.lastRunAt).ymd !== now.ymd
  }
  if (s.everyMinutes != null) {
    if (s.lastRunAt == null) return true
    return nowMs - s.lastRunAt >= s.everyMinutes * 60_000
  }
  return false
}
