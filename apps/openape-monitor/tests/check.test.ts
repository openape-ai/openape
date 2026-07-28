import { describe, expect, it } from 'vitest'
import { checkOnce, isDue, isUpStatus } from '../server/utils/check-core'

describe('isUpStatus', () => {
  it('treats 2xx and 3xx as up, 4xx and 5xx as down', () => {
    expect(isUpStatus(200)).toBe(true)
    expect(isUpStatus(301)).toBe(true)
    expect(isUpStatus(399)).toBe(true)
    expect(isUpStatus(400)).toBe(false)
    expect(isUpStatus(404)).toBe(false)
    expect(isUpStatus(500)).toBe(false)
  })
})

describe('isDue', () => {
  it('is due when never checked', () => {
    expect(isDue({ lastCheckedAt: null, intervalSec: 300 }, 1000)).toBe(true)
  })
  it('is due only once the interval has elapsed', () => {
    expect(isDue({ lastCheckedAt: 1000, intervalSec: 300 }, 1299)).toBe(false)
    expect(isDue({ lastCheckedAt: 1000, intervalSec: 300 }, 1300)).toBe(true)
  })
})

describe('checkOnce SSRF guard', () => {
  it('refuses loopback without fetching', async () => {
    const r = await checkOnce('http://127.0.0.1:8080/')
    expect(r.up).toBe(false)
    expect(r.statusCode).toBeNull()
    expect(r.error).toBeTruthy()
  })
  it('refuses non-http(s) schemes', async () => {
    const r = await checkOnce('file:///etc/passwd')
    expect(r.up).toBe(false)
    expect(r.error).toBeTruthy()
  })
})
