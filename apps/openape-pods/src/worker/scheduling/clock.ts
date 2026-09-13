import type { ScheduleSpec } from '../../contracts/scheduling'

function formatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}
function wallTime(format: Intl.DateTimeFormat, instant: number): { day: string, minute: number } {
  const parts = Object.fromEntries(format.formatToParts(instant).map(part => [part.type, part.value]))
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) }
}
export function nextDaily(spec: Extract<ScheduleSpec, { kind: 'daily' }>, after: number): number {
  const format = formatter(spec.timezone)
  const day = wallTime(format, after).day
  const [hour, minute] = spec.time.split(':').map(Number)
  const target = hour * 60 + minute
  const midnight = Date.parse(`${day}T00:00:00Z`)
  for (let offset = 0; offset < 4; offset++) {
    const utcDay = midnight + offset * 86400000
    const date = new Date(utcDay).toISOString().slice(0, 10)
    for (let instant = utcDay - 18 * 3600000; instant < utcDay + 42 * 3600000; instant += 60000) {
      const local = wallTime(format, instant)
      if (local.day !== date || local.minute < target) continue
      if (instant > after) return instant
      break
    }
  }
  throw new Error('No daily slot found in the supported calendar range')
}
export function nextDue(spec: ScheduleSpec, previous: number | null, now: number): number {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid scheduler clock')
  if (spec.kind === 'daily') return nextDaily(spec, now)
  const interval = spec.seconds * 1000
  if (previous === null) return now + interval
  return previous > now ? previous : previous + (Math.floor((now - previous) / interval) + 1) * interval
}
