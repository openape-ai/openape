import { describe, expect, it } from 'vitest'
import { suche } from '../shared/search'

const data = {
  vorgaenge: [{
    id: 'v1',
    titel: 'Kepler Labs – Plattform',
    phase: 'kunde' as const,
    stufe: 'zahlend',
    firma: 'Kepler Labs GmbH',
    personen: ['Julia Pfeiffer'],
    emails: ['julia@keplerlabs.io'],
    historie: ['Interesse an Dokumentensafe revisionssicher'],
  }],
  personen: [{ id: 'k6', name: 'Julia Pfeiffer', email: 'julia@keplerlabs.io' }],
  firmen: [{ id: 'f5', name: 'Kepler Labs GmbH', ort: 'Wien' }],
}

describe('suche', () => {
  it('returns nothing for blank query', () => {
    expect(suche('  ', data)).toEqual([])
  })

  it('finds a firm by name', () => {
    expect(suche('kepler', data).some(t => t.typ === 'Firma' && t.id === 'f5')).toBe(true)
  })

  it('finds a vorgang via historie full text', () => {
    expect(suche('revisionssicher', data).some(t => t.typ === 'Vorgang' && t.id === 'v1')).toBe(true)
  })

  it('caps at 12 hits', () => {
    const many = {
      vorgaenge: [] as typeof data.vorgaenge,
      personen: [] as typeof data.personen,
      firmen: Array.from({ length: 20 }, (_, i) => ({ id: `f${i}`, name: `Acme ${i}`, ort: 'Wien' })),
    }
    expect(suche('acme', many)).toHaveLength(12)
  })
})
