/**
 * Pure display logic for the KPI board — labels, tones, ordering. Extracted
 * per repo policy so the component only renders; this file is unit-tested.
 *
 * The STORE stays semantics-free (scope/key are opaque there). Interpreting
 * well-known key patterns for friendlier labels is a presentation concern
 * and lives only here.
 */

export interface KpiLike {
  scope: string
  key: string
  value: number
  unit: string | null
  createdAt: number
}

export type Tone = 'attention' | 'done' | 'neutral'

const LABELS: Array<[RegExp, string]> = [
  [/^mail\.attention$/, 'Mails, die Aufmerksamkeit brauchen'],
  [/^mail\.inbox$/, 'Bewusst in der Inbox'],
  [/^mail\.archived/, 'Zuletzt archiviert'],
  [/^tasks\.open$/, 'Offene Tasks'],
  [/^tasks\.due$/, 'Fällige Tasks'],
  [/^calendar\.today$/, 'Termine heute'],
  [/^calendar\.upcoming$/, 'Termine (nächste 7 Tage)'],
  [/\.prs_merged_24h$/, 'Gemergte PRs (24 h)'],
  [/^rechnungen\.abgelegt$/, 'Abgelegte Rechnungen'],
  [/^grants\.pending$/, 'Grants warten auf Freigabe'],
]

export function labelForKey(key: string): string {
  for (const [re, label] of LABELS) {
    if (re.test(key))
      return label
  }
  return key
}

/** Attention pulls amber, completed work pulls green, the rest stays quiet. */
export function toneForKey(key: string, value: number): Tone {
  if (/attention|due|overdue|pending|^tasks\.open$/.test(key))
    return value > 0 ? 'attention' : 'done'
  if (/merged|done|archived|abgelegt/.test(key))
    return 'done'
  return 'neutral'
}

/** Fixed briefing order — predictability beats dramaturgy (decision 13.8.). */
const THEME_ORDER = [
  'mail.attention',
  'calendar.upcoming',
  'tasks.open',
  'grants.pending',
  'mail.inbox',
  'rechnungen.abgelegt',
  'mail.archived',
]

export interface ThemeGroup<T extends KpiLike = KpiLike> {
  key: string
  label: string
  tone: Tone
  total: number
  unit: string | null
  members: T[]
}

/**
 * One card per THEME (= metric key), accounts/scopes become sub-sections
 * inside it — "which mails need me?" is one question across all accounts.
 * Themes follow THEME_ORDER, unknown keys append alphabetically. Members
 * sort by value desc, empty ones last.
 */
export function themeGroups<T extends KpiLike>(kpis: T[]): ThemeGroup<T>[] {
  const byKey = new Map<string, T[]>()
  for (const kpi of kpis) {
    const list = byKey.get(kpi.key)
    if (list)
      list.push(kpi)
    else
      byKey.set(kpi.key, [kpi])
  }
  const keys = [...byKey.keys()].sort((a, b) => {
    const ia = THEME_ORDER.indexOf(a)
    const ib = THEME_ORDER.indexOf(b)
    return (ia === -1 ? THEME_ORDER.length : ia) - (ib === -1 ? THEME_ORDER.length : ib) || a.localeCompare(b)
  })
  return keys.map((key) => {
    const members = byKey.get(key)!.slice().sort((a, b) => b.value - a.value || a.scope.localeCompare(b.scope))
    const tones = members.map(m => toneForKey(m.key, m.value))
    return {
      key,
      label: labelForKey(key),
      tone: tones.includes('attention') ? 'attention' as Tone : tones.every(t => t === 'done') ? 'done' as Tone : 'neutral' as Tone,
      total: Math.round(members.reduce((sum, m) => sum + m.value, 0) * 100) / 100,
      unit: members[0]?.unit ?? null,
      members,
    }
  })
}

export interface Chip {
  id: string
  text: string
}

/** "Heute wartet"-strip: one anchor chip per attention KPI, biggest first. */
export function summaryChips<T extends KpiLike & { id: string }>(kpis: T[]): Chip[] {
  return kpis
    .filter(k => toneForKey(k.key, k.value) === 'attention')
    .sort((a, b) => b.value - a.value)
    .map(k => ({
      id: k.id,
      text: `${topScope(k.scope)}: ${k.value}${k.unit ? ` ${k.unit}` : ''}`,
    }))
}

/** The calm counterpart: what is already handled. */
export function doneSummary(kpis: KpiLike[]): string[] {
  return kpis
    .filter(k => toneForKey(k.key, k.value) === 'done')
    .map((k) => {
      if (k.value <= 0)
        return `${topScope(k.scope)} leer`
      const label = labelForKey(k.key)
      return `${k.value} ${label.charAt(0).toLowerCase()}${label.slice(1)}`
    })
}

export function totalWaiting(kpis: KpiLike[]): number {
  return Math.round(kpis
    .filter(k => toneForKey(k.key, k.value) === 'attention')
    .reduce((sum, k) => sum + k.value, 0))
}

/**
 * Enforce the number-vs-list contract in the board, not only in producer docs:
 * how many items does the value promise beyond what the detail list shows?
 * Counts <li> in the sanitized HTML and honors an existing "+N weitere" rest
 * marker. 0 = consistent (or not a list at all).
 */
export function missingRest(value: number, detailHtml: string): number {
  if (!Number.isInteger(value) || value <= 0)
    return 0
  const liCount = (detailHtml.match(/<li[\s>]/g) || []).length
  if (liCount === 0)
    return 0
  const marker = detailHtml.match(/\+\s*(\d+)\s+weitere/i)
  const covered = marker ? (liCount - 1) + Number(marker[1]) : liCount
  return Math.max(0, value - covered)
}

export function topScope(scope: string): string {
  return scope.split('/')[0] as string
}

export function formatValue(kpi: KpiLike): string {
  return Number.isInteger(kpi.value) ? String(kpi.value) : kpi.value.toFixed(2)
}

export function formatAge(ts: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - ts) / 60000))
  if (min < 60)
    return `vor ${min} min`
  if (min < 60 * 24)
    return `vor ${Math.round(min / 60)} h`
  return `vor ${Math.round(min / 60 / 24)} d`
}
