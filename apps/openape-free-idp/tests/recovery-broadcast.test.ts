// story: recovery-broadcast
//
// A recovery request must warn the owner on EVERY channel — push to all
// subscribed devices and mail to every address ever linked to the account —
// and a single dead channel must never silence the rest (issue #462).
//
// Surface assumptions for the green phase (adjust mocks, not assertions):
//   - push fan-out via `sendRecoveryWarningPush(email, { cancelUrl })`
//     in server/utils/push.ts (per-device fan-out pinned in
//     tests/recovery-warning-push.test.ts)
//   - warning mail (warning + cancel ONLY) via
//     `sendRecoveryWarningEmail(to, ...)` in server/utils/email.ts;
//     the completion-link mail stays `sendRecoveryEmail` (current address only)
//   - all ever-linked addresses via useIdpStores().emailHistoryStore.listAllForEmail(email)

import { InMemoryRecoveryStore } from '@openape/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const EMAIL = 'owner@example.com'
const FORMER_EMAIL = 'old-address@example.com'

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
  sendRecoveryWarningEmailMock.mockReset().mockResolvedValue(undefined)
  sendRecoveryWarningPushMock.mockReset().mockResolvedValue(undefined)
  recoveryStore = new InMemoryRecoveryStore()
  vi.stubGlobal('useIdpStores', () => ({
    recoveryStore,
    userStore: {
      findByEmail: async (email: string) =>
        email === EMAIL ? { email: EMAIL, name: 'Owner', isActive: true, createdAt: 1 } : null,
    },
    emailHistoryStore: {
      listAllForEmail: async () => [EMAIL, FORMER_EMAIL],
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

function allCallArgs(mock: { mock: { calls: unknown[][] } }) {
  return JSON.stringify(mock.mock.calls)
}

describe('recovery warning broadcast (issue #462)', () => {
  // story: recovery-broadcast — criterion 1
  it('sends a warning push to the owner on every recovery request', async () => {
    await requestRecovery()
    expect(sendRecoveryWarningPushMock).toHaveBeenCalledTimes(1)
    expect(sendRecoveryWarningPushMock.mock.calls[0][0]).toBe(EMAIL)
    expect(allCallArgs(sendRecoveryWarningPushMock)).toContain('/recover/cancel?token=')
  })

  // story: recovery-broadcast — criterion 2
  it('mails the warning to every address ever linked — including former ones', async () => {
    await requestRecovery()
    const warnedAddresses = [
      ...sendRecoveryEmailMock.mock.calls.map(call => call[0]),
      ...sendRecoveryWarningEmailMock.mock.calls.map(call => call[0]),
    ]
    expect(warnedAddresses).toContain(EMAIL)
    expect(warnedAddresses).toContain(FORMER_EMAIL)
  })

  // story: recovery-broadcast — criterion 5
  it('former addresses and push get warning + cancel only — never the completion link', async () => {
    await requestRecovery()

    // The completion link goes to the current account address only.
    expect(sendRecoveryEmailMock.mock.calls.map(call => call[0])).toEqual([EMAIL])

    // Warning mails (incl. the former address) and push payloads carry the
    // one-tap cancel, but no link that could complete the recovery.
    expect(sendRecoveryWarningEmailMock.mock.calls.map(call => call[0])).toContain(FORMER_EMAIL)
    for (const channelArgs of [allCallArgs(sendRecoveryWarningEmailMock), allCallArgs(sendRecoveryWarningPushMock)]) {
      expect(channelArgs).toContain('/recover/cancel?token=')
      expect(channelArgs).not.toContain('/recover?token=')
    }
  })

  // story: recovery-broadcast — criterion 6
  it('a failing channel never blocks the remaining warnings', async () => {
    sendRecoveryWarningEmailMock.mockImplementation(async (to: string) => {
      if (to === FORMER_EMAIL)
        throw new Error('mailbox gone')
    })

    const response = await requestRecovery()

    expect(response).toEqual({ ok: true })
    expect(sendRecoveryWarningPushMock).toHaveBeenCalled()
    expect(sendRecoveryEmailMock.mock.calls.map(call => call[0])).toContain(EMAIL)
  })

  // story: recovery-broadcast — criterion 7
  it('rate-limits repeated recovery requests per account', async () => {
    const { checkRateLimit } = await vi.importActual<typeof import('../server/utils/rate-limiter')>('../server/utils/rate-limiter')

    for (let i = 0; i < 3; i++)
      checkRateLimit('limited-owner@example.com', `198.51.100.${i}`)

    expect(() => checkRateLimit('limited-owner@example.com', '198.51.100.99'))
      .toThrowError(expect.objectContaining({ statusCode: 429 }))
  })
})
