import { describe, expect, it } from 'vitest'
import { nextOfferNumber } from '../shared/offer'

describe('nextOfferNumber', () => {
  it('starts at 001 for the year', () => {
    expect(nextOfferNumber([], 2026)).toBe('AG-2026-001')
  })

  it('increments the highest number of that year', () => {
    expect(nextOfferNumber(['AG-2026-001', 'AG-2026-041', 'AG-2025-999'], 2026)).toBe('AG-2026-042')
  })
})
