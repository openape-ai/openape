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

/** Spread deals across the workspace stages, each column sorted by `position`. */
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
 * The new id order of a column after `dealId` was dropped into it: before
 * `beforeId`, or at the end when dropped on the column's empty area. A card
 * coming from another column simply slots in.
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
 * Nuxt UI's Select forbids an entry with an empty value — there the empty
 * string IS the "nothing selected" signal. The "without …" option therefore
 * needs a key of its own, turned back into `null` at the API boundary.
 * A ULID cannot collide with it.
 */
export const NO_SELECTION = 'none'

export function selectionToId(value: string): string | null {
  return value === NO_SELECTION || value === '' ? null : value
}

export function idToSelection(id: string | null | undefined): string {
  return id ?? NO_SELECTION
}
