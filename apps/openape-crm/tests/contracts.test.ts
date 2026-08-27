import { describe, expect, it } from 'vitest'
import { positionsSumme, vertragsArt, vertragsWert, vertragsende } from '../shared/contracts'

describe('vertragsArt', () => {
  it('is gemischt when laufend and einmalig mix', () => {
    expect(vertragsArt({ positionen: [
      { abrechnung: 'monatlich' },
      { abrechnung: 'einmalig' },
    ] })).toBe('gemischt')
  })

  it('is einmalig when every line is einmalig', () => {
    expect(vertragsArt({ positionen: [{ abrechnung: 'einmalig' }] })).toBe('einmalig')
  })
})

describe('vertragsende', () => {
  it('adds minimum term months to the start date', () => {
    expect(vertragsende({ startdatum: '2026-09-15', mindestlaufzeit: 12 })).toBe('2027-09-15')
  })

  it('is null without a minimum term', () => {
    expect(vertragsende({ startdatum: '2026-01-01', mindestlaufzeit: null })).toBeNull()
  })
})

describe('vertragsWert', () => {
  it('sums price minus discount', () => {
    expect(positionsSumme({ preis: 490, rabatt: 40 })).toBe(450)
    expect(vertragsWert({ positionen: [
      { preis: 490, rabatt: 40 },
      { preis: 2400, rabatt: 0 },
    ] })).toBe(2850)
  })
})
