import { describe, expect, it } from 'vitest'
import { healthPayload } from '../server/api/health.get'

describe('health endpoint', () => {
  it('returns a static ok payload with no auth/DB dependency', () => {
    const payload = healthPayload()
    expect(payload.ok).toBe(true)
    expect(payload.service).toBe('openape-chat')
  })
})
