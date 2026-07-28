import { Cron } from 'croner'

export interface Schedule { atHour: number | null, everyMinutes: number | null, fireAt: number | null, cronExpr: string | null, enabled: boolean, lastRunAt: number | null, createdAt: number }

const TZ = 'Europe/Vienna'
function vienna(ms: number): { ymd: string, hour: number } {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return { ymd: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 }
}

// Standard 5-field cron in Europe/Vienna. Valid → true. Used to reject bad input.
export function isValidCron(expr: string): boolean {
  try {
    const c = new Cron(expr, { timezone: TZ })
    return c.nextRun() != null || c.getPattern() != null
  }
  catch {
    return false
  }
}

// The first scheduled run strictly after `fromMs`, or null (invalid pattern / none).
function cronNextRun(expr: string, fromMs: number): number | null {
  try {
    const next = new Cron(expr, { timezone: TZ }).nextRun(new Date(fromMs))
    return next ? next.getTime() : null
  }
  catch {
    return null
  }
}

// Is this schedule due at `nowMs`? Timer (fireAt): one-shot, due once the target
// time passed and it hasn't run (the evaluator disables it after). Cron (cronExpr):
// due when a scheduled occurrence lies in (lastRunAt ?? createdAt, now] — fires once
// per occurrence. Daily (atHour): once per Vienna-day from atHour on. Periodic
// (everyMinutes): when that long has passed since the last run.
export function isDue(s: Schedule, nowMs: number): boolean {
  if (!s.enabled) return false
  if (s.fireAt != null) {
    return s.lastRunAt == null && nowMs >= s.fireAt
  }
  if (s.cronExpr) {
    const next = cronNextRun(s.cronExpr, s.lastRunAt ?? s.createdAt)
    return next != null && next <= nowMs
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
