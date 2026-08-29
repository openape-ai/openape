import type { Deal } from '../app/utils/board'
import type { PipelineStage } from '../shared/stages'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STAGES } from '../shared/stages'
import { buildColumns, dropInto, formatEuro, idToSelection, NO_SELECTION, selectionToId } from '../app/utils/board'

const STAGES: PipelineStage[] = DEFAULT_STAGES.map((stage, position) => ({ ...stage, position }))

function deal(id: string, stage: string, position: number, valueCents = 0): Deal {
  // `stage` stays a raw string here on purpose: the column logic has to cope
  // with a row whose stage no longer exists in the code.
  return {
    id,
    title: id,
    value_cents: valueCents,
    stage,
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
    const columns = buildColumns([], STAGES)
    expect(columns.map(c => c.stage.key)).toEqual(['lead', 'qualified', 'proposal', 'won', 'lost'])
    expect(columns.every(c => c.deals.length === 0)).toBe(true)
  })

  it('sorts a column by position, not by arrival order', () => {
    const columns = buildColumns([deal('b', 'lead', 1), deal('a', 'lead', 0)], STAGES)
    expect(columns[0]!.deals.map(d => d.id)).toEqual(['a', 'b'])
  })

  it('sums the values of each column', () => {
    const columns = buildColumns([deal('a', 'lead', 0, 5000), deal('b', 'lead', 1, 2500), deal('c', 'won', 0, 100)], STAGES)
    expect(columns[0]!.totalCents).toBe(7500)
    expect(columns.find(c => c.stage.key === 'won')!.totalCents).toBe(100)
  })

  it('ignores a stage that is not in the pipeline instead of inventing a column', () => {
    expect(buildColumns([deal('x', 'archived', 0)], STAGES).every(c => c.deals.length === 0)).toBe(true)
  })

  it('follows a renamed pipeline, keys and order included', () => {
    const custom: PipelineStage[] = [
      { key: 'won', name: 'Auftrag', outcome: 'won', position: 0 },
      { key: 'lead', name: 'Anfrage', outcome: 'open', position: 1 },
    ]
    const columns = buildColumns([deal('a', 'lead', 0)], custom)
    expect(columns.map(c => c.stage.name)).toEqual(['Auftrag', 'Anfrage'])
    expect(columns[1]!.deals.map(d => d.id)).toEqual(['a'])
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

describe('selection sentinel', () => {
  // Ein Eintrag mit leerem Wert liess Nuxt UIs Select werfen und die ganze
  // crash the page with a 500 — the "without …" option needs a real value.
  it('never uses an empty string as an option value', () => {
    expect(NO_SELECTION).not.toBe('')
  })

  it('maps the sentinel back to null at the API boundary', () => {
    expect(selectionToId(NO_SELECTION)).toBeNull()
    expect(selectionToId('')).toBeNull()
    expect(selectionToId('01M08K3EW5NYFW8652SQXEKJY1')).toBe('01M08K3EW5NYFW8652SQXEKJY1')
  })

  it('shows the sentinel for a record without a link', () => {
    expect(idToSelection(null)).toBe(NO_SELECTION)
    expect(idToSelection(undefined)).toBe(NO_SELECTION)
    expect(idToSelection('01M08K3EW5NYFW8652SQXEKJY1')).toBe('01M08K3EW5NYFW8652SQXEKJY1')
  })
})
