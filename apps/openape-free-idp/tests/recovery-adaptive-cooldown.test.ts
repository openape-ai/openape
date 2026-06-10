// story: recovery-adaptive-cooldown
//
// The recovery waiting period must follow account activity (issue #462):
//   - signed in within the last 30 days        → 7 days
//   - inactive for 30+ days, no vacation mode  → 72 hours (v1 default)
//   - vacation mode on                          → owner-configured, default
//     and hard cap 14 days, regardless of activity
//
// Surface assumptions for the green phase (adjust mocks, not assertions):
//   - the user row carries `lastLoginAt` (ms epoch, maintained by the login
//     flow) plus `recoveryVacationMode` / `recoveryVacationDays`
//   - the handler under test stays apps/openape-free-idp/server/api/recovery/request.post.ts

import { InMemoryRecoveryStore } from '@openape/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = Date.parse('2026-06-10T12:00:00.000Z')
const EMAIL = 'owner@example.com'

const readBodyMock = vi.fn()
const sendRecoveryEmailMock = vi.fn(async () => {})

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), opts),
  readBody: (...args: any[]) => readBodyMock(...args),
  getRequestIP: () => '203.0.113.7',
  getHeader: () => 'TestBrowser/1.0',
  getRequestURL: () => new URL('https://id.openape.test/api/recovery/request'),
}))

vi.mock('../server/utils/rate-limiter', () => ({
  checkRateLimit: vi.fn(),
}))

vi.mock('../server/utils/email', () => ({
  sendRecoveryEmail: (...args: any[]) => sendRecoveryEmailMock(...args),
}))

let recoveryStore: InMemoryRecoveryStore
let user: Record<string, unknown> | null

function setUser(overrides: Record<string, unknown>) {
  user = { email: EMAIL, name: 'Owner', isActive: true, createdAt: 1, ...overrides }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  readBodyMock.mockReset().mockResolvedValue({ email: EMAIL })
  sendRecoveryEmailMock.mockClear()
  recoveryStore = new InMemoryRecoveryStore()
  user = null
  vi.stubGlobal('useIdpStores', () => ({
    recoveryStore,
    userStore: {
      findByEmail: async (email: string) => (user && email === EMAIL ? user : null),
    },
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function requestRecovery() {
  const handler = (await import('../server/api/recovery/request.post')).default
  const response = await handler({} as any)
  const [token] = await recoveryStore.listActiveForEmail(EMAIL)
  return { response, token }
}

describe('adaptive recovery waiting period (issue #462)', () => {
  // story: recovery-adaptive-cooldown — criterion 1
  it('waits 7 days when the owner signed in within the last 30 days', async () => {
    setUser({ lastLoginAt: NOW - 10 * DAY })
    const { token } = await requestRecovery()
    expect(token.usableAt).toBe(NOW + 7 * DAY)
  })

  // story: recovery-adaptive-cooldown — criterion 2
  it('waits 72 hours when the owner has been inactive for 30+ days and vacation mode is off', async () => {
    setUser({ lastLoginAt: NOW - 40 * DAY })
    const { token } = await requestRecovery()
    expect(token.usableAt).toBe(NOW + 72 * HOUR)
  })

  // story: recovery-adaptive-cooldown — criterion 3
  it('vacation mode forces the 14-day default wait regardless of recent activity', async () => {
    setUser({ lastLoginAt: NOW - 1 * DAY, recoveryVacationMode: true })
    const { token } = await requestRecovery()
    expect(token.usableAt).toBe(NOW + 14 * DAY)
  })

  // story: recovery-adaptive-cooldown — criterion 3
  it('vacation mode honours the owner-configured duration below the 14-day cap', async () => {
    setUser({ lastLoginAt: NOW - 40 * DAY, recoveryVacationMode: true, recoveryVacationDays: 10 })
    const { token } = await requestRecovery()
    expect(token.usableAt).toBe(NOW + 10 * DAY)
  })

  // story: recovery-adaptive-cooldown — criteria 5 + 6
  // The deadline is fixed at request time and the warning mail names that
  // exact instant. (That a later login/settings change cannot shorten a
  // running deadline is pinned module-side in
  // modules/nuxt-auth-idp/test/recovery-cooldown-enforcement.test.ts.)
  it('warning mail names the actual instant the recovery becomes completable', async () => {
    setUser({ lastLoginAt: NOW - 10 * DAY })
    const { token } = await requestRecovery()
    expect(token.usableAt).toBe(NOW + 7 * DAY)
    expect(sendRecoveryEmailMock).toHaveBeenCalledWith(
      EMAIL,
      expect.stringContaining('/recover?token='),
      token.usableAt,
      expect.stringContaining('/recover/cancel?token='),
    )
  })

  // story: recovery-adaptive-cooldown — criterion 6
  it('response never reveals whether the account exists or which wait applies', async () => {
    setUser({ lastLoginAt: NOW - 10 * DAY })
    const { response: knownResponse } = await requestRecovery()

    readBodyMock.mockResolvedValue({ email: 'nobody@nowhere.example' })
    const handler = (await import('../server/api/recovery/request.post')).default
    const unknownResponse = await handler({} as any)

    expect(unknownResponse).toEqual(knownResponse)
    expect(JSON.stringify(knownResponse)).not.toMatch(/usableAt|expiresAt|\d{10,}/)
  })
})
