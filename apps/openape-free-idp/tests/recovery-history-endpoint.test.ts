// story: recovery-audit
//
// Criteria 2-6: the signed-in owner — and only the owner — can read the
// history of all recovery attempts (time, origin, outcome) in the account
// settings; the history leaks no usable secrets and offers no way to alter
// or delete entries.
//
// Pins the endpoint surface for the green phase:
//   handler  apps/openape-free-idp/server/api/settings/recovery-history.get.ts
//   auth     global `requireAuth(event)` → owner email
//   data     useIdpStores().recoveryStore.listAllForEmail(<owner email>)
//   shape    array of { requestedAt, requestIp, requestUserAgent, status, usableAt? }
//            with status ∈ pending | completed | cancelled | expired

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = Date.parse('2026-06-10T12:00:00.000Z')
const EMAIL = 'alice@example.com'

const requireAuthMock = vi.fn()
const listAllForEmailMock = vi.fn()

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), opts),
}))

function historyFixtures() {
  return [
    { token: 'tok-secret-pending', email: EMAIL, createdAt: NOW - 1 * DAY, usableAt: NOW + 6 * DAY, expiresAt: NOW + 20 * DAY, cancelled: false, consumed: false, requestIp: '203.0.113.7', requestUserAgent: 'TestBrowser/1.0' },
    { token: 'tok-secret-cancelled', email: EMAIL, createdAt: NOW - 10 * DAY, usableAt: NOW - 3 * DAY, expiresAt: NOW + 11 * DAY, cancelled: true, cancelledAt: NOW - 9 * DAY, cancelledReason: 'cancelled-by-owner', consumed: false, requestIp: '198.51.100.2', requestUserAgent: 'OtherBrowser/2.0' },
    { token: 'tok-secret-completed', email: EMAIL, createdAt: NOW - 30 * DAY, usableAt: NOW - 23 * DAY, expiresAt: NOW - 9 * DAY, cancelled: false, consumed: true, requestIp: '198.51.100.3', requestUserAgent: 'TestBrowser/1.0' },
    { token: 'tok-secret-expired', email: EMAIL, createdAt: NOW - 60 * DAY, usableAt: NOW - 53 * DAY, expiresAt: NOW - 39 * DAY, cancelled: false, consumed: false, requestIp: '198.51.100.4', requestUserAgent: 'TestBrowser/1.0' },
  ]
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  requireAuthMock.mockReset().mockResolvedValue(EMAIL)
  listAllForEmailMock.mockReset().mockResolvedValue(historyFixtures())
  vi.stubGlobal('requireAuth', requireAuthMock)
  vi.stubGlobal('useIdpStores', () => ({
    recoveryStore: { listAllForEmail: listAllForEmailMock },
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function getHistory() {
  const handler = (await import('../server/api/settings/recovery-history.get')).default
  return await handler({} as any) as Record<string, unknown>[]
}

describe('recovery history in the account settings (issue #462)', () => {
  // story: recovery-audit — criterion 2
  it('shows every attempt with time, origin and outcome', async () => {
    const entries = await getHistory()

    expect(entries).toHaveLength(4)
    for (const entry of entries) {
      expect(entry.requestedAt).toBeTypeOf('number')
      expect(entry.requestIp).toBeTypeOf('string')
      expect(entry.requestUserAgent).toBeTypeOf('string')
    }
    expect(entries.map(entry => entry.status).sort())
      .toEqual(['cancelled', 'completed', 'expired', 'pending'])
  })

  // story: recovery-audit — criterion 3
  it('a running attempt shows when it could complete; an unused lapsed one shows as expired', async () => {
    const entries = await getHistory()

    const pending = entries.find(entry => entry.status === 'pending')
    expect(pending).toBeDefined()
    expect(pending!.usableAt).toBe(NOW + 6 * DAY)

    expect(entries.filter(entry => entry.status === 'expired')).toHaveLength(1)
  })

  // story: recovery-audit — criterion 4
  it('is unreachable without a signed-in session', async () => {
    requireAuthMock.mockRejectedValue(Object.assign(new Error('Authentication required'), { statusCode: 401 }))

    const handler = (await import('../server/api/settings/recovery-history.get')).default
    await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 401 })
    expect(listAllForEmailMock).not.toHaveBeenCalled()
  })

  // story: recovery-audit — criterion 4
  it('only ever queries the signed-in owner\'s history', async () => {
    await getHistory()
    expect(listAllForEmailMock).toHaveBeenCalledTimes(1)
    expect(listAllForEmailMock).toHaveBeenCalledWith(EMAIL)
  })

  // story: recovery-audit — criterion 5
  it('leaks no usable secrets — no tokens, no completion or cancel links', async () => {
    const entries = await getHistory()
    const serialized = JSON.stringify(entries)
    expect(serialized).not.toContain('tok-secret')
    expect(serialized).not.toContain('/recover')
  })

  // story: recovery-audit — criterion 6
  it('the route is read-only — a GET handler exists and no mutating sibling does', async () => {
    const settingsDir = join(__dirname, '../server/api/settings')
    const handlers = existsSync(settingsDir)
      ? readdirSync(settingsDir).filter(file => file.startsWith('recovery-history.'))
      : []
    expect(handlers).toEqual(['recovery-history.get.ts'])
  })
})
