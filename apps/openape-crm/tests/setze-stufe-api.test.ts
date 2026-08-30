import { describe, expect, it } from 'vitest'
import { applyStufePatch } from '../server/utils/pipelines'

describe('applyStufePatch', () => {
  it('writes kunde/onboarding and a log on the gewonnen endmarker', () => {
    const r = applyStufePatch({ phase: 'deal', stufe: 'angebot' }, 'gewonnen', 1000)
    expect(r.fields).toEqual({ phase: 'kunde', stufe: 'onboarding', closedAt: null })
    expect(r.log?.title).toContain('Kunde')
    expect(r.log?.body).toContain('Gewonnen')
  })

  it('sets closedAt when landing on an endstufe', () => {
    const r = applyStufePatch({ phase: 'deal', stufe: 'angebot' }, 'verloren', 1000)
    expect(r.fields).toEqual({ phase: 'deal', stufe: 'verloren', closedAt: 1000 })
    expect(r.log).toBeUndefined()
  })

  it('clears closedAt when moving back to an open stufe', () => {
    const r = applyStufePatch({ phase: 'deal', stufe: 'verloren' }, 'inbound', 1000)
    expect(r.fields.closedAt).toBeNull()
    expect(r.fields.stufe).toBe('inbound')
  })
})
