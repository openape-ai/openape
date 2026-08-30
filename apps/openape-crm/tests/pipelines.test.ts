import { describe, expect, it } from 'vitest'
import { groupByStufe, migrateFromOutcome, PIPELINES, planDealMigration, setzeStufe, stufe } from '../shared/pipelines'

describe('PIPELINES', () => {
  it('has three phases with the demo stage keys', () => {
    expect(PIPELINES.lead.stufen.map(s => s.id)).toEqual(
      ['kalt', 'warm', 'kontaktiert', 'konvertiert', 'disqualifiziert', 'blacklist'],
    )
    expect(PIPELINES.deal.stufen.map(s => s.id)).toEqual(
      ['inbound', 'termin', 'demo', 'followup', 'angebot', 'gewonnen', 'spaet', 'verloren'],
    )
    expect(PIPELINES.kunde.stufen.map(s => s.id)).toEqual(
      ['onboarding', 'zahlend', 'abwehr', 'gekuendigt'],
    )
  })

  it('marks conversion stages as endmarkers', () => {
    expect(stufe('lead', 'konvertiert')?.endmarker).toBe('deal')
    expect(stufe('deal', 'gewonnen')?.endmarker).toBe('kunde')
  })
})

describe('setzeStufe', () => {
  it('moves a deal onto a normal stage in the same phase', () => {
    expect(setzeStufe({ phase: 'deal', stufe: 'inbound' }, 'demo')).toEqual({
      phase: 'deal', stufe: 'demo', konvertiert: false,
    })
  })

  it('converts through an endmarker onto the first stage of the next phase', () => {
    const r = setzeStufe({ phase: 'deal', stufe: 'angebot' }, 'gewonnen')
    expect(r.konvertiert).toBe(true)
    expect(r.phase).toBe('kunde')
    expect(r.stufe).toBe('onboarding')
    expect(r.logTitle).toContain('Kunde')
  })

  it('does not convert a normal kunde stage', () => {
    expect(setzeStufe({ phase: 'kunde', stufe: 'onboarding' }, 'zahlend').konvertiert).toBe(false)
  })
})

describe('migrateFromOutcome', () => {
  it('maps old board outcomes onto deal stages without jumping to kunde', () => {
    expect(migrateFromOutcome('open')).toEqual({ phase: 'deal', stufe: 'inbound' })
    expect(migrateFromOutcome('won')).toEqual({ phase: 'deal', stufe: 'gewonnen' })
    expect(migrateFromOutcome('lost')).toEqual({ phase: 'deal', stufe: 'verloren' })
  })
})

describe('planDealMigration', () => {
  it('plans one patch per deal from the old stage outcome', () => {
    expect(planDealMigration([
      { id: 'a', outcome: 'open' },
      { id: 'b', outcome: 'won' },
    ])).toEqual([
      { id: 'a', phase: 'deal', stufe: 'inbound' },
      { id: 'b', phase: 'deal', stufe: 'gewonnen' },
    ])
  })
})

describe('groupByStufe', () => {
  it('groups items under the phase stages and skips empty groups', () => {
    const groups = groupByStufe(
      [{ id: 'a', stufe: 'demo' }, { id: 'b', stufe: 'demo' }, { id: 'c', stufe: 'inbound' }],
      'deal',
    )
    expect(groups.map(g => [g.stufe.id, g.items.map(i => i.id)])).toEqual([
      ['inbound', ['c']],
      ['demo', ['a', 'b']],
    ])
  })
})
