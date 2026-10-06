import { describe, expect, it } from 'vitest'
import { stageKey } from '../shared/stages'

describe('stageKey', () => {
  it('slugifies the name so the key stays readable in the CLI', () => {
    expect(stageKey('Verloren – Preis', [])).toBe('verloren-preis')
  })

  it('transliterates umlauts instead of dropping them', () => {
    expect(stageKey('Angebot überfällig', [])).toBe('angebot-ueberfaellig')
  })

  it('counts up when the key is already taken', () => {
    expect(stageKey('Verloren', ['verloren'])).toBe('verloren-2')
    expect(stageKey('Verloren', ['verloren', 'verloren-2'])).toBe('verloren-3')
  })

  it('falls back to a generic key when nothing survives slugifying', () => {
    expect(stageKey('🎯', [])).toBe('stufe')
    expect(stageKey('🎯', ['stufe'])).toBe('stufe-2')
  })
})
