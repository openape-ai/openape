import type { Stage } from '#shared/stages'
import { STAGES } from '#shared/stages'

export interface Deal {
  id: string
  title: string
  value_cents: number
  stage: Stage
  position: number
  contact_id: string | null
  contact_name: string | null
  org_id: string | null
  org_name: string | null
  created_at: number
  closed_at: number | null
}

export interface Column {
  stage: Stage
  deals: Deal[]
  totalCents: number
}

/** Deals auf die fünf Spalten verteilen, jede nach `position` sortiert. */
export function buildColumns(deals: Deal[]): Column[] {
  return STAGES.map((stage) => {
    const inStage = deals
      .filter(d => d.stage === stage)
      .sort((a, b) => a.position - b.position)
    return {
      stage,
      deals: inStage,
      totalCents: inStage.reduce((sum, d) => sum + d.value_cents, 0),
    }
  })
}

/**
 * Die neue ID-Reihenfolge einer Spalte, nachdem `dealId` dort abgelegt wurde:
 * vor `beforeId`, oder am Ende, wenn auf die leere Spaltenfläche gezogen wurde.
 * Kam die Karte aus einer anderen Spalte, fügt sie sich einfach ein.
 */
export function dropInto(columnIds: string[], dealId: string, beforeId: string | null): string[] {
  const without = columnIds.filter(id => id !== dealId)
  if (!beforeId || beforeId === dealId) return [...without, dealId]

  const at = without.indexOf(beforeId)
  if (at === -1) return [...without, dealId]
  return [...without.slice(0, at), dealId, ...without.slice(at)]
}

export function formatEuro(cents: number): string {
  return new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
    .format(cents / 100)
}
