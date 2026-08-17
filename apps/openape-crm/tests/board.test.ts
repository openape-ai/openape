import type { Deal } from '../app/utils/board'
import { describe, expect, it } from 'vitest'
import { buildColumns, dropInto, formatEuro } from '../app/utils/board'

function deal(id: string, stage: string, position: number, valueCents = 0): Deal {
  // `stage` bleibt hier absichtlich ein roher String: die Spaltenlogik muss
  // auch mit einer Zeile klarkommen, deren Stufe es im Code nicht mehr gibt.
  return {
    id,
    title: id,
    value_cents: valueCents,
    stage: stage as Deal['stage'],
    position,
    contact_id: null,
    contact_name: null,
    org_id: null,
    org_name: null,
    created_at: 0,
    closed_at: null,
  }
}

describe('buildColumns', () => {
  it('returns one column per stage, even when empty', () => {
    const columns = buildColumns([])
    expect(columns.map(c => c.stage)).toEqual(['lead', 'qualified', 'proposal', 'won', 'lost'])
    expect(columns.every(c => c.deals.length === 0)).toBe(true)
  })

  it('sorts a column by position, not by arrival order', () => {
    const columns = buildColumns([deal('b', 'lead', 1), deal('a', 'lead', 0)])
    expect(columns[0]!.deals.map(d => d.id)).toEqual(['a', 'b'])
  })

  it('sums the values of each column', () => {
    const columns = buildColumns([deal('a', 'lead', 0, 5000), deal('b', 'lead', 1, 2500), deal('c', 'won', 0, 100)])
    expect(columns[0]!.totalCents).toBe(7500)
    expect(columns.find(c => c.stage === 'won')!.totalCents).toBe(100)
  })

  it('ignores an unknown stage instead of inventing a column', () => {
    expect(buildColumns([deal('x', 'archived', 0)]).every(c => c.deals.length === 0)).toBe(true)
  })
})

describe('dropInto', () => {
  it('appends when dropped on empty column space', () => {
    expect(dropInto(['a', 'b'], 'c', null)).toEqual(['a', 'b', 'c'])
  })

  it('inserts before the card it was dropped on', () => {
    expect(dropInto(['a', 'b', 'c'], 'x', 'b')).toEqual(['a', 'x', 'b', 'c'])
  })

  it('moves a card within its own column without duplicating it', () => {
    expect(dropInto(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
  })

  it('keeps the order when a card is dropped on itself', () => {
    expect(dropInto(['a', 'b'], 'a', 'a')).toEqual(['b', 'a'])
  })
})

describe('formatEuro', () => {
  it('renders cents as whole euros', () => {
    expect(formatEuro(500000)).toContain('5.000')
    expect(formatEuro(0)).toContain('0')
  })
})
