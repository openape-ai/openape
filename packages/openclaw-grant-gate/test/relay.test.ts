import { describe, expect, it } from 'vitest'
import { grantTypeForDecision } from '../src/grants.js'

/**
 * The mapping from an OpenClaw approval decision to a grant lifetime is the
 * whole contract of the relay. `allow-always` in particular must become a
 * standing grant, or the operator taps "always" and gets asked again next time.
 */
describe('grantTypeForDecision', () => {
  it('maps allow-once to a single-use grant', () => {
    expect(grantTypeForDecision('allow-once')).toBe('once')
  })

  it('maps allow-always to a standing grant', () => {
    expect(grantTypeForDecision('allow-always')).toBe('always')
  })

  // Anything that is not an approval must not produce a grant type, so the
  // relay cannot accidentally approve on a deny, a timeout or a cancellation.
  it.each(['deny', 'timeout', 'cancelled', '', 'allow'])('yields no grant type for %j', (decision) => {
    expect(grantTypeForDecision(decision)).toBeNull()
  })
})
