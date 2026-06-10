// story: recovery-broadcast
//
// Criteria 3, 4 + 5: tapping "cancel" in a warning (mail or push) must kill
// the recovery attempt immediately — WITHOUT a login or any further step —
// the cancellation is permanent, and the cancel mechanism can never be used
// to complete a recovery or to sign in.
//
// Green-phase surface: api/recovery/cancel.post.ts accepts a tokenized body
// `{ token }` (the /recover/cancel?token=… link minted at request time) in
// addition to the existing session-authenticated owner veto.

import { InMemoryRecoveryStore } from '@openape/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const EMAIL = 'owner@example.com'

const readBodyMock = vi.fn()
const sessionUpdateMock = vi.fn()
const sessionClearMock = vi.fn()
const consumeChallengeMock = vi.fn()
const createRegistrationOptionsMock = vi.fn()
const verifyRegistrationMock = vi.fn()

let recoveryStore: InMemoryRecoveryStore
let sessionData: Record<string, unknown>

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  readBody: (...args: any[]) => readBodyMock(...args),
  getQuery: () => ({}),
}))

vi.mock('@openape/auth', async importOriginal => ({
  ...(await importOriginal<object>()),
  createRegistrationOptions: (...args: any[]) => createRegistrationOptionsMock(...args),
  verifyRegistration: (...args: any[]) => verifyRegistrationMock(...args),
}))

vi.mock('../src/runtime/server/utils/session', () => ({
  getAppSession: vi.fn(async () => ({ data: sessionData, update: sessionUpdateMock, clear: sessionClearMock })),
}))

vi.mock('../src/runtime/server/utils/rp-config', () => ({
  getRPConfig: () => ({ rpID: 'id.openape.ai' }),
}))

vi.mock('../src/runtime/server/utils/stores', () => ({
  useIdpStores: () => ({
    recoveryStore,
    challengeStore: { consume: consumeChallengeMock, save: vi.fn() },
    credentialStore: { deleteAllForUser: vi.fn(), save: vi.fn() },
    userStore: { findByEmail: vi.fn(async () => ({ email: EMAIL, name: 'Owner' })), create: vi.fn() },
  }),
}))

vi.mock('../src/runtime/server/utils/problem', () => ({
  createProblemError: (opts: any) =>
    Object.assign(new Error(opts.title), { statusCode: opts.status, data: opts }),
}))

function makeToken(overrides: Record<string, unknown> = {}) {
  const now = Date.now()
  return {
    token: 'rec-1',
    email: EMAIL,
    createdAt: now,
    usableAt: now + 13 * DAY,
    expiresAt: now + 27 * DAY,
    cancelled: false,
    consumed: false,
    ...overrides,
  }
}

beforeEach(() => {
  recoveryStore = new InMemoryRecoveryStore()
  sessionData = {} // anonymous — the person tapping a mail/push link has NO session
  readBodyMock.mockReset()
  sessionUpdateMock.mockReset()
  sessionClearMock.mockReset()
  consumeChallengeMock.mockReset()
  createRegistrationOptionsMock.mockReset()
  verifyRegistrationMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function cancelHandler() {
  return (await import('../src/runtime/server/api/recovery/cancel.post')).default
}

async function optionsHandler() {
  return (await import('../src/runtime/server/api/recovery/options.post')).default
}

describe('one-tap recovery cancel (issue #462)', () => {
  // story: recovery-broadcast — criterion 3
  it('cancels via the warning-link token — no login, no further steps', async () => {
    await recoveryStore.save(makeToken() as any)
    readBodyMock.mockResolvedValue({ token: 'rec-1' })

    const handler = await cancelHandler()
    const result = await handler({} as any)

    expect(result).toMatchObject({ ok: true })
    expect(await recoveryStore.find('rec-1')).toBeNull()
  })

  // story: recovery-broadcast — criterion 3
  it('the tokenized cancel works for the entire waiting period', async () => {
    // Day 13 of a 14-day vacation wait — one hour before the deadline.
    await recoveryStore.save(makeToken({ usableAt: Date.now() + 1 * HOUR }) as any)
    readBodyMock.mockResolvedValue({ token: 'rec-1' })

    const handler = await cancelHandler()
    await handler({} as any)

    expect(await recoveryStore.find('rec-1')).toBeNull()
  })

  // story: recovery-broadcast — criterion 5
  it('cancelling never signs anyone in and returns no usable secrets', async () => {
    await recoveryStore.save(makeToken() as any)
    readBodyMock.mockResolvedValue({ token: 'rec-1' })

    const handler = await cancelHandler()
    const result = await handler({} as any)

    expect(sessionUpdateMock).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toMatch(/access_token|challenge|credential/)
  })

  // story: recovery-broadcast — criterion 4
  it('a cancelled attempt stays dead — even after its waiting period has passed', async () => {
    await recoveryStore.save(makeToken({ usableAt: Date.now() - 1 * HOUR }) as any)
    await recoveryStore.cancelAllForEmail(EMAIL, 'cancelled-by-owner')
    readBodyMock.mockResolvedValue({ token: 'rec-1' })

    const handler = await optionsHandler()
    await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 404 })
    expect(createRegistrationOptionsMock).not.toHaveBeenCalled()
  })
})
