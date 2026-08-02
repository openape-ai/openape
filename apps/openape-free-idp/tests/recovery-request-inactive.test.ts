// A deactivated account must not receive a recovery mail: since #1146 the
// module routes (/api/recovery/options|verify) refuse inactive accounts, so
// the token in the mail is useless — the mail would only confuse the owner
// and keep an unnecessary mail channel open.
//
// Anti-enumeration: the route must keep answering with the same neutral
// `{ ok: true }` it gives for unknown emails — a 403 here would leak that
// the account exists AND is deactivated.

import { InMemoryRecoveryStore } from '@openape/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const EMAIL = 'deactivated-owner@example.com'

const readBodyMock = vi.fn()
const sendRecoveryEmailMock = vi.fn(async () => {})
const sendRecoveryWarningEmailMock = vi.fn(async () => {})
const sendRecoveryWarningPushMock = vi.fn(async () => {})

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
  sendRecoveryWarningEmail: (...args: any[]) => sendRecoveryWarningEmailMock(...args),
}))

vi.mock('../server/utils/push', () => ({
  sendRecoveryWarningPush: (...args: any[]) => sendRecoveryWarningPushMock(...args),
}))

let recoveryStore: InMemoryRecoveryStore

beforeEach(() => {
  readBodyMock.mockReset().mockResolvedValue({ email: EMAIL })
  sendRecoveryEmailMock.mockClear()
  sendRecoveryWarningEmailMock.mockClear()
  sendRecoveryWarningPushMock.mockClear()
  recoveryStore = new InMemoryRecoveryStore()
  vi.stubGlobal('useIdpStores', () => ({
    recoveryStore,
    userStore: {
      findByEmail: async (email: string) =>
        email === EMAIL ? { email: EMAIL, name: 'Owner', isActive: false, createdAt: 1 } : null,
    },
    emailHistoryStore: {
      listAllForEmail: async () => [EMAIL],
    },
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function requestRecovery() {
  const handler = (await import('../server/api/recovery/request.post')).default
  return await handler({} as any)
}

describe('recovery request for a deactivated account', () => {
  it('sends no recovery mail, no warnings, and mints no token', async () => {
    await requestRecovery()

    expect(sendRecoveryEmailMock).not.toHaveBeenCalled()
    expect(sendRecoveryWarningEmailMock).not.toHaveBeenCalled()
    expect(sendRecoveryWarningPushMock).not.toHaveBeenCalled()
  })

  it('answers with the same neutral response as for unknown emails', async () => {
    const response = await requestRecovery()

    expect(response).toEqual({ ok: true })
  })
})
