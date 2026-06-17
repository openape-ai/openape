import { describe, expect, it } from 'vitest'
import { isRuntimeType } from '../src/lib/nest-registry'

// The single source of allowed agent runtimes — `apes agents spawn --type`
// (and ape-troop) validate against it. Lock the set so a new runtime is a
// deliberate change, not a typo that slips through.
describe('isRuntimeType', () => {
  it('accepts the known runtimes', () => {
    expect(isRuntimeType('bridge')).toBe(true)
    expect(isRuntimeType('openclaw')).toBe(true)
  })
  it('rejects anything else', () => {
    for (const v of ['openClaw', 'BRIDGE', 'pi', '', undefined, null, 5, {}])
      expect(isRuntimeType(v)).toBe(false)
  })
})
