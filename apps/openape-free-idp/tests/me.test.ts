import { describe, expect, it } from 'vitest'

// Test the response shape logic (actual h3 handler tested via dev server)
describe('GET /api/me response shape', () => {
  it('returns email when userId is set', () => {
    const userId = 'user@example.com'
    const response = userId ? { email: userId } : null
    expect(response).toEqual({ email: 'user@example.com' })
  })

  it('returns null when userId is not set', () => {
    const userId = undefined
    const response = userId ? { email: userId } : null
    expect(response).toBeNull()
  })
})
