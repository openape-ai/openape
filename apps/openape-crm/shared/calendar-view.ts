export function parseGraphDateTime(value: string | null | undefined): Date | null {
  if (!value) return null
  const raw = value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

export function dayKey(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function startOfWeekMonday(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d
}

export function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

export function addDays(date: Date, amount: number): Date {
  const d = new Date(date.getTime())
  d.setUTCDate(d.getUTCDate() + amount)
  return d
}

export function addMonths(date: Date, amount: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1))
}

export function monthGridDays(anchor: Date): Date[] {
  const first = startOfMonth(anchor)
  const start = startOfWeekMonday(first)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

export function weekDays(anchor: Date): Date[] {
  const start = startOfWeekMonday(anchor)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

export function eventsOnDay<T extends { start: string | null }>(events: T[], day: Date): T[] {
  const key = dayKey(day)
  return events.filter((ev) => {
    const start = parseGraphDateTime(ev.start)
    return start ? dayKey(start) === key : false
  })
}

export function formatBytes(size: number | null | undefined): string {
  if (size == null) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${Math.round(size / (1024 * 1024))} MB`
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()
}

export function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b)
}

export function weekdayLabels(): string[] {
  return ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
}

export function monthTitle(date: Date): string {
  return date.toLocaleDateString('de-AT', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function timeLabel(value: string | null): string {
  const d = parseGraphDateTime(value)
  if (!d) return ''
  return d.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
}
