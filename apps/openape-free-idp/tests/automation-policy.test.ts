import { describe, expect, it } from 'vitest'
import { formatProvenance, fullAutoFromMode, isIneffectiveFullAuto, modeFromFullAuto } from '../app/utils/automation-policy'

describe('automation policy projection', () => {
  it('maps Vollautomatik onto the historical mode enum and back', () => {
    expect(modeFromFullAuto(true)).toBe('deny-list')
    expect(modeFromFullAuto(false)).toBe('allow-list')
    expect(fullAutoFromMode('deny-list')).toBe(true)
    expect(fullAutoFromMode('allow-list')).toBe(false)
  })

  it('flags a Vollautomatik without any restriction as ineffective (server no-op)', () => {
    expect(isIneffectiveFullAuto(true, 0, null)).toBe(true)
    expect(isIneffectiveFullAuto(true, 1, null)).toBe(false)
    expect(isIneffectiveFullAuto(true, 0, 'high')).toBe(false)
    expect(isIneffectiveFullAuto(false, 0, null)).toBe(false)
  })

  it('renders a provenance line with author and timestamp', () => {
    const line = formatProvenance('patrick@hofmann.eco', 1_755_700_000)
    expect(line).toContain('patrick@hofmann.eco')
    expect(line).toContain('Zuletzt gesetzt von')
  })
})
