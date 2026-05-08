import catalog from '../tool-catalog.json'

const KNOWN_TOOLS = new Set<string>(catalog.tools.map((t: { name: string }) => t.name))

// Tiny cron-syntax subset that the apes-runtime's launchd reconciler
// can translate to `StartCalendarInterval`. We accept the 95% — every
// other syntax (lists, ranges, step on day fields, @-shortcuts) gets
// rejected at create time so the agent host doesn't end up with a
// task it can't actually schedule.
//
// Supported patterns (5 fields: minute hour day-of-month month day-of-week):
//   *                 every value
//   N                 fixed value (0–59 / 0–23 / 1–31 / 1–12 / 0–7)
//   */N               every Nth (only on minute and hour fields)
//
// Field-by-field validators below; the whole expression must match.

const STAR = '*'
function validField(token: string, min: number, max: number, allowStep: boolean): boolean {
  if (token === STAR) return true
  if (allowStep && token.startsWith('*/')) {
    const n = Number(token.slice(2))
    return Number.isInteger(n) && n >= 1 && n <= max
  }
  const n = Number(token)
  return Number.isInteger(n) && n >= min && n <= max
}

export function validateCron(expr: string): { ok: true } | { ok: false, reason: string } {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) {
    return { ok: false, reason: 'cron must have exactly 5 fields (minute hour day-of-month month day-of-week)' }
  }
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string]
  if (!validField(minute, 0, 59, true)) return { ok: false, reason: `invalid minute field: ${minute}` }
  if (!validField(hour, 0, 23, true)) return { ok: false, reason: `invalid hour field: ${hour}` }
  if (!validField(dom, 1, 31, false)) return { ok: false, reason: `invalid day-of-month field: ${dom}` }
  if (!validField(month, 1, 12, false)) return { ok: false, reason: `invalid month field: ${month}` }
  if (!validField(dow, 0, 7, false)) return { ok: false, reason: `invalid day-of-week field: ${dow}` }
  return { ok: true }
}

export function validateTools(tools: unknown): { ok: true, tools: string[] } | { ok: false, reason: string } {
  if (!Array.isArray(tools)) return { ok: false, reason: 'tools must be an array of strings' }
  if (!tools.every(t => typeof t === 'string')) return { ok: false, reason: 'tools must contain only strings' }
  const unknown = (tools as string[]).filter(t => !KNOWN_TOOLS.has(t))
  if (unknown.length > 0) {
    return { ok: false, reason: `unknown tool(s): ${unknown.join(', ')}` }
  }
  return { ok: true, tools: tools as string[] }
}

const TASK_ID_RE = /^[a-z][a-z0-9-]{0,63}$/
export function validateTaskId(id: unknown): { ok: true } | { ok: false, reason: string } {
  if (typeof id !== 'string') return { ok: false, reason: 'task_id must be a string' }
  if (!TASK_ID_RE.test(id)) {
    return { ok: false, reason: 'task_id must match /^[a-z][a-z0-9-]{0,63}$/' }
  }
  return { ok: true }
}
