import { describe, expect, it } from 'vitest'
import { isKnownScope, scopesAreCovered, TROOP_SCOPES } from '../server/utils/scope-catalog'

describe('troop scope catalog', () => {
  it('publishes at least the spawn + destroy + read trio', () => {
    const ids = TROOP_SCOPES.map(s => s.id)
    expect(ids).toContain('troop:spawn-agent')
    expect(ids).toContain('troop:destroy-agent')
    expect(ids).toContain('troop:read-agents')
  })

  it('publishes the nest:* device-binding trio (M4δ)', () => {
    const ids = TROOP_SCOPES.map(s => s.id)
    expect(ids).toContain('nest:bind')
    expect(ids).toContain('nest:spawn-agent')
    expect(ids).toContain('nest:report-status')
  })

  it('every entry has the spec-required shape (sp-data-access §3.2)', () => {
    for (const s of TROOP_SCOPES) {
      expect(typeof s.id).toBe('string')
      expect(s.id).toMatch(/^(?:troop|nest):[a-z-]+$/)
      expect(typeof s.description).toBe('string')
      expect(s.description.length).toBeGreaterThan(10)
      expect(Array.isArray(s.grants)).toBe(true)
    }
  })

  it('isKnownScope rejects unknown ids', () => {
    expect(isKnownScope('troop:spawn-agent')).toBe(true)
    expect(isKnownScope('troop:not-a-thing')).toBe(false)
    expect(isKnownScope('chat:read')).toBe(false)
    expect(isKnownScope('')).toBe(false)
  })

  it('scopesAreCovered returns the full list of unknowns', () => {
    expect(scopesAreCovered(['troop:spawn-agent'])).toEqual({ ok: true })
    expect(scopesAreCovered([])).toEqual({ ok: true })
    expect(scopesAreCovered(['troop:spawn-agent', 'troop:made-up', 'chat:read']))
      .toEqual({ ok: false, unknown: ['troop:made-up', 'chat:read'] })
  })
})
