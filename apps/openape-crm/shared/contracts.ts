export type Abrechnung = 'monatlich' | 'jaehrlich' | 'einmalig' | 'verwendung'
export type VertragsArt = 'einmalig' | 'laufend' | 'gemischt'

export function positionsSumme(pos: { preis: number, rabatt?: number }): number {
  return pos.preis - (pos.rabatt || 0)
}

export function vertragsArt(vertrag: { positionen: { abrechnung: string }[] }): VertragsArt {
  const arten = new Set(vertrag.positionen.map(p => (p.abrechnung === 'einmalig' ? 'einmalig' : 'laufend')))
  return arten.size > 1 ? 'gemischt' : ([...arten][0] as VertragsArt) || 'laufend'
}

export function vertragsWert(vertrag: { positionen: { preis: number, rabatt?: number }[] }): number {
  return vertrag.positionen.reduce((s, p) => s + positionsSumme(p), 0)
}

export function vertragsende(vertrag: { startdatum: string, mindestlaufzeit: number | null }): string | null {
  if (!vertrag.mindestlaufzeit) return null
  const d = new Date(`${vertrag.startdatum}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + vertrag.mindestlaufzeit)
  return d.toISOString().slice(0, 10)
}

export const WAEHRUNGEN = ['EUR', 'CHF', 'USD', 'GBP', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'CAD', 'AUD', 'JPY'] as const
export const ABRECHNUNG: { id: Abrechnung, label: string }[] = [
  { id: 'monatlich', label: 'monatlich' },
  { id: 'jaehrlich', label: 'jährlich' },
  { id: 'einmalig', label: 'einmalig' },
  { id: 'verwendung', label: 'nach Verwendung' },
]
