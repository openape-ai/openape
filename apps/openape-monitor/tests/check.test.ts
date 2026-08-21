import { describe, expect, it } from 'vitest'
import { checkHeartbeat, checkOnce, isDue, isUpStatus } from '../server/utils/check-core'

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

describe('checkHeartbeat', () => {
  it('is down before the first ping, and says so', () => {
    const r = checkHeartbeat({ lastPingAt: null, intervalSec: 900 }, 1000)
    expect(r.up).toBe(false)
    expect(r.error).toBe('No ping received yet')
  })

  it('is up while the last ping is within the budget', () => {
    expect(checkHeartbeat({ lastPingAt: 1000, intervalSec: 900 }, 1900).up).toBe(true)
  })

  it('goes down one second past the budget', () => {
    expect(checkHeartbeat({ lastPingAt: 1000, intervalSec: 900 }, 1901).up).toBe(false)
  })

  it('names the age and the budget so the alert mail is actionable', () => {
    const r = checkHeartbeat({ lastPingAt: 1000, intervalSec: 900 }, 4000)
    expect(r.error).toBe('Last ping 3000s ago, budget is 900s')
  })

  it('reports no status code or latency — nothing was fetched', () => {
    const r = checkHeartbeat({ lastPingAt: 1000, intervalSec: 900 }, 1100)
    expect(r.statusCode).toBeNull()
    expect(r.latencyMs).toBeNull()
  })
})
