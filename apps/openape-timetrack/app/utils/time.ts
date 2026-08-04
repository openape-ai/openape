/**
 * Pure time/calendar logic, extracted from `pages/me.vue` so it is testable
 * without mounting the page (issue #1172).
 */

/** Minutes → "3h30m" / "45m"; whole hours drop the minute part ("2h"). */
export function fmt(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h${m ? `${m}m` : ''}` : `${m}m`
}

/** Epoch seconds → "HH:MM" (UTC), em-dash when unset. */
export function hhmm(e: number | null): string {
  return e ? new Date(e * 1000).toISOString().slice(11, 16) : '—'
}

/** "YYYY-MM-DD" + "H:MM" → epoch seconds (UTC), null on malformed time. */
export function toEpoch(date: string, t: string): number | null {
  const m = t.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const base = new Date(`${date}T00:00:00Z`)
  return Number.isNaN(base.getTime()) ? null : Math.floor(base.getTime() / 1000) + Number(m[1]) * 3600 + Number(m[2]) * 60
}

export function monthBounds(ym: string): { first: string, last: string, y: number, m: number } {
  const [y, m] = ym.split('-').map(Number)
  const first = `${ym}-01`
  const last = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10)
  return { first, last, y: y!, m: m! }
}

/** Calendar grid: weeks (Mon-first) covering the month, padded with nulls. */
export function monthGrid(ym: string): Array<Array<{ date: string | null }>> {
  const { y, m } = monthBounds(ym)
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7 // Mon=0
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells: Array<{ date: string | null }> = []
  for (let i = 0; i < firstDow; i++) cells.push({ date: null })
  for (let d = 1; d <= days; d++) cells.push({ date: `${ym}-${String(d).padStart(2, '0')}` })
  while (cells.length % 7 !== 0) cells.push({ date: null })
  const weeks: Array<Array<{ date: string | null }>> = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

export interface DayEntry {
  entry_date: string
  duration_minutes: number
  is_break: boolean
  overlap: boolean
}

export interface DayTotals { work: number, brk: number, overlap: boolean }

/** Work/break minutes per day; a day is flagged as soon as one entry overlaps. */
export function totalsByDay(entries: DayEntry[]): Map<string, DayTotals> {
  const map = new Map<string, DayTotals>()
  for (const e of entries) {
    const d = map.get(e.entry_date) ?? { work: 0, brk: 0, overlap: false }
    if (e.is_break) d.brk += e.duration_minutes
    else d.work += e.duration_minutes
    if (e.overlap) d.overlap = true
    map.set(e.entry_date, d)
  }
  return map
}
