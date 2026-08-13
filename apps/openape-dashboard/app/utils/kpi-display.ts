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
  [/^mail\.archived/, 'Archivierte Mails'],
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

/**
 * Flat card order by urgency: attention (value desc), then neutral, then
 * done/empty at the bottom — never an empty inbox above waiting work.
 */
export function orderedCards<T extends KpiLike>(kpis: T[]): T[] {
  const rank: Record<Tone, number> = { attention: 0, neutral: 1, done: 2 }
  return kpis.slice().sort((a, b) => {
    const ra = rank[toneForKey(a.key, a.value)]
    const rb = rank[toneForKey(b.key, b.value)]
    return ra - rb || b.value - a.value || a.scope.localeCompare(b.scope)
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
