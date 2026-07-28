import { defineCommand } from 'citty'
import { apiCall } from '../api.ts'
import { resolveProjectId } from '../config.ts'
import { info, printJson, printLine } from '../output.ts'

function fmt(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h${m > 0 ? `${m}m` : ''}` : `${m}m`
}

/** "HH:MM" + "YYYY-MM-DD" → unix seconds (UTC). */
function toEpoch(date: string, hhmm: string): number | null {
  const t = hhmm.match(/^(\d{1,2}):(\d{2})$/)
  if (!t) return null
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return Math.floor(d.getTime() / 1000) + Number(t[1]) * 3600 + Number(t[2]) * 60
}

export const logCommand = defineCommand({
  meta: { name: 'log', description: 'Log a duration time entry.' },
  args: {
    project: { type: 'string', description: 'Project ULID (or use default).' },
    duration: { type: 'string', description: 'Minutes ("45") or "1h30m".' },
    from: { type: 'string', description: 'Start HH:MM (with --to).' },
    to: { type: 'string', description: 'End HH:MM (with --from).' },
    date: { type: 'string', description: 'YYYY-MM-DD (default today).' },
    type: { type: 'string', description: 'code|research|planning|review|admin|meeting (default code).' },
    desc: { type: 'string', description: 'Description.' },
    billable: { type: 'boolean', description: 'Billable (default true; use --no-billable).', default: true },
    break: { type: 'boolean', description: 'Log this as a pause/break (never billable).' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const project = resolveProjectId(args.project, args.endpoint)
    const body: Record<string, unknown> = {
      project_id: project,
      type: args.type ?? 'code',
      billable: args.billable !== false,
      is_break: args.break === true,
      created_via: 'cli',
    }
    if (args.desc) body.description = args.desc
    if (args.date) body.date = args.date
    if (args.from && args.to) {
      const date = args.date ?? new Date().toISOString().slice(0, 10)
      const s = toEpoch(date, args.from)
      const e = toEpoch(date, args.to)
      if (s == null || e == null) throw Object.assign(new Error('--from/--to must be HH:MM'), { status: 400, title: 'Bad time' })
      body.started_at = s
      body.ended_at = e
    }
    else {
      if (!args.duration) throw Object.assign(new Error('Provide --duration or --from/--to'), { status: 400, title: 'Missing duration' })
      body.duration = args.duration
    }
    const en = await apiCall<{ id: string, duration_minutes: number, project_id: string, act: string }>(
      'POST', '/api/entries', { endpoint: args.endpoint, body },
    )
    if (args.json) { printJson(en); return }
    printLine(`${en.id}  ${fmt(en.duration_minutes)}  project ${en.project_id}  (${en.act})`)
  },
})

export const listCommand = defineCommand({
  meta: { name: 'list', description: 'List time entries you can see.' },
  args: {
    company: { type: 'string', description: 'Filter by company ULID.' },
    project: { type: 'string', description: 'Filter by project ULID.' },
    from: { type: 'string', description: 'From date YYYY-MM-DD.' },
    to: { type: 'string', description: 'To date YYYY-MM-DD.' },
    mine: { type: 'boolean', description: 'Only my entries.' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const query: Record<string, string | boolean> = {}
    if (args.company) query.company = args.company
    if (args.project) query.project = args.project
    if (args.from) query.from = args.from
    if (args.to) query.to = args.to
    if (args.mine) query.mine = true
    const rows = await apiCall<Array<{
      id: string, entry_date: string, duration_minutes: number, type: string,
      billable: boolean, is_break: boolean, user_email: string, description: string
    }>>('GET', '/api/entries', { endpoint: args.endpoint, query })
    if (args.json) { printJson(rows); return }
    if (rows.length === 0) { info('No entries.'); return }
    for (const e of rows) {
      const tag = e.is_break ? 'PAUSE   ' : e.type.padEnd(8)
      printLine(`${e.entry_date}  ${fmt(e.duration_minutes).padStart(6)}  ${tag}  ${e.is_break ? 'P' : e.billable ? 'B' : ' '}  ${e.user_email}  ${e.description}`)
    }
  },
})

export const editCommand = defineCommand({
  meta: { name: 'edit', description: 'Edit a time entry.' },
  args: {
    id: { type: 'positional', required: true, description: 'Entry ULID.' },
    duration: { type: 'string', description: 'New duration.' },
    desc: { type: 'string', description: 'New description.' },
    type: { type: 'string', description: 'New type.' },
    billable: { type: 'boolean', description: 'Set billable (--no-billable to unset).' },
    date: { type: 'string', description: 'New date YYYY-MM-DD.' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const body: Record<string, unknown> = {}
    if (args.duration) body.duration = args.duration
    if (args.desc != null) body.description = args.desc
    if (args.type) body.type = args.type
    if (typeof args.billable === 'boolean') body.billable = args.billable
    if (args.date) body.date = args.date
    const en = await apiCall('PATCH', `/api/entries/${args.id}`, { endpoint: args.endpoint, body })
    if (args.json) { printJson(en); return }
    info(`Updated ${args.id}`)
  },
})

export const rmCommand = defineCommand({
  meta: { name: 'rm', description: 'Delete a time entry.' },
  args: {
    id: { type: 'positional', required: true, description: 'Entry ULID.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    await apiCall('DELETE', `/api/entries/${args.id}`, { endpoint: args.endpoint })
    info(`Deleted ${args.id}`)
  },
})
