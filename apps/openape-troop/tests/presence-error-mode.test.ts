import { describe, expect, it } from 'vitest'
import { presenceErrorMode } from '../app/composables/useCockpitPresence'

// #995: a failed presence poll must never claim "Operator offline" when the
// real problem is the owner's session (401) or the network.
describe('presenceErrorMode', () => {
  it('401 → unauthenticated (login expired, not the operator)', () => {
    expect(presenceErrorMode({ statusCode: 401 })).toBe('unauthenticated')
  })

  it('network / anything else → disconnected', () => {
    expect(presenceErrorMode(new TypeError('fetch failed'))).toBe('disconnected')
    expect(presenceErrorMode({ statusCode: 500 })).toBe('disconnected')
    expect(presenceErrorMode(undefined)).toBe('disconnected')
  })
})
