import { defineCommand } from 'citty'
import { apiCall } from '../api.ts'
import { info, printJson, printLine } from '../output.ts'

interface MeEntry {
  id: string
  entry_date: string
  duration_minutes: number
  started_at: number | null
  ended_at: number | null
  type: string
  billable: boolean
  is_break: boolean
  description: string
  project_name: string
  company_name: string
  overlap: boolean
}

function fmt(min: number): string {
  const h = Math.floor(min / 60); const m = min % 60
  return h > 0 ? `${h}h${m ? `${m}m` : ''}` : `${m}m`
}
function hhmm(e: number | null): string {
  return e ? new Date(e * 1000).toISOString().slice(11, 16) : '--:--'
}
function monthBounds(ym: string): { first: string, last: string } {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10)
  return { first: `${ym}-01`, last }
}

/**
 * Personal cross-project hours for a month, with overlap markers (⚠).
 *   ape-timetrack me                # current month
 *   ape-timetrack me --month 2026-05 --json
 */
export const meCommand = defineCommand({
  meta: { name: 'me', description: 'Your own hours across all projects for a month (with overlap warnings).' },
  args: {
    month: { type: 'string', description: 'YYYY-MM (default current month).' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const ym = args.month && /^\d{4}-\d{2}$/.test(args.month)
      ? args.month
      : new Date().toISOString().slice(0, 7)
    const { first, last } = monthBounds(ym)
    const rows = await apiCall<MeEntry[]>('GET', '/api/me/entries', {
      endpoint: args.endpoint,
      query: { from: first, to: last },
    })
    if (args.json) { printJson(rows); return }
    if (rows.length === 0) { info(`No entries in ${ym}.`); return }

    let work = 0; let billable = 0; let brk = 0; let overlaps = 0
    let curDay = ''
    for (const e of rows) {
      if (e.entry_date !== curDay) {
        curDay = e.entry_date
        printLine(`\n${curDay}`)
      }
      if (e.is_break) brk += e.duration_minutes
      else { work += e.duration_minutes; if (e.billable) billable += e.duration_minutes }
      if (e.overlap) overlaps++
      const tag = e.is_break ? 'PAUSE' : e.type
      printLine(
        `  ${hhmm(e.started_at)}-${hhmm(e.ended_at)}  ${fmt(e.duration_minutes).padStart(6)}  `
        + `${e.company_name}/${e.project_name}  ${tag}${e.billable && !e.is_break ? ' B' : ''}`
        + `${e.overlap ? '  ⚠ overlap' : ''}  ${e.description}`,
      )
    }
    printLine(`\n${ym}: work ${fmt(work)} (billable ${fmt(billable)}, pause ${fmt(brk)})`
      + `${overlaps ? `  — ${overlaps} overlapping entr${overlaps === 1 ? 'y' : 'ies'}` : ''}`)
  },
})
