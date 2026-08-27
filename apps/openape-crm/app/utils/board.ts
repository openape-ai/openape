export interface Deal {
  id: string
  title: string
  value_cents: number
  phase: string
  stufe: string
  stage: string
  position: number
  contact_id: string | null
  contact_name: string | null
  org_id: string | null
  org_name: string | null
  people: { id: string, name: string, email?: string | null }[]
  created_at: number
  closed_at: number | null
}

export function formatEuro(cents: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('de-AT', { style: 'currency', currency, maximumFractionDigits: 0 })
    .format(cents / 100)
}

export const NO_SELECTION = 'none'

export function selectionToId(value: string): string | null {
  return value === NO_SELECTION || value === '' ? null : value
}

export function idToSelection(id: string | null | undefined): string {
  return id ?? NO_SELECTION
}
