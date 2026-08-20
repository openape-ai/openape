import type { PipelineStage } from '#shared/stages'

export interface Deal {
  id: string
  title: string
  value_cents: number
  stage: string
  position: number
  contact_id: string | null
  contact_name: string | null
  org_id: string | null
  org_name: string | null
  created_at: number
  closed_at: number | null
}

export interface Column {
  stage: PipelineStage
  deals: Deal[]
  totalCents: number
}

/** Deals auf die Stufen des Workspaces verteilen, jede Spalte nach `position` sortiert. */
export function buildColumns(deals: Deal[], stages: PipelineStage[]): Column[] {
  return stages.map((stage) => {
    const inStage = deals
      .filter(d => d.stage === stage.key)
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

/**
 * Nuxt UIs Select verbietet einen Eintrag mit leerem Wert — der leere String
 * IST dort das Signal „nichts gewählt". Die Option „ohne …" braucht deshalb
 * einen eigenen Schlüssel, der an der API-Grenze wieder zu `null` wird.
 * Ein ULID kann damit nicht kollidieren.
 */
export const NO_SELECTION = 'none'

export function selectionToId(value: string): string | null {
  return value === NO_SELECTION || value === '' ? null : value
}

export function idToSelection(id: string | null | undefined): string {
  return id ?? NO_SELECTION
}
