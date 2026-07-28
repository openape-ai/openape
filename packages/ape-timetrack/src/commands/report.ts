import { defineCommand } from 'citty'
import { apiCall } from '../api.ts'
import { printJson, printLine } from '../output.ts'

function fmt(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}h${m.toString().padStart(2, '0')}m`
}

export const reportCommand = defineCommand({
  meta: { name: 'report', description: 'Aggregated time report (total vs billable).' },
  args: {
    company: { type: 'string', description: 'Filter by company ULID.' },
    project: { type: 'string', description: 'Filter by project ULID.' },
    from: { type: 'string', description: 'From date YYYY-MM-DD.' },
    to: { type: 'string', description: 'To date YYYY-MM-DD.' },
    by: { type: 'string', description: 'Group by project|type|user|day (default project).' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const query: Record<string, string> = { by: args.by ?? 'project' }
    if (args.company) query.company = args.company
    if (args.project) query.project = args.project
    if (args.from) query.from = args.from
    if (args.to) query.to = args.to
    const r = await apiCall<{
      by: string
      total_minutes: number
      billable_minutes: number
      break_minutes: number
      groups: Array<{ key: string, label: string, total_minutes: number, billable_minutes: number, break_minutes: number, entries: number }>
    }>('GET', '/api/report', { endpoint: args.endpoint, query })
    if (args.json) { printJson(r); return }
    printLine(`Report by ${r.by} — work ${fmt(r.total_minutes)} (billable ${fmt(r.billable_minutes)}, pause ${fmt(r.break_minutes)})`)
    for (const g of r.groups) {
      const pause = g.break_minutes ? `  pause ${fmt(g.break_minutes)}` : ''
      printLine(`  ${g.label}  ${fmt(g.total_minutes)}  billable ${fmt(g.billable_minutes)}${pause}  (${g.entries})`)
    }
  },
})
