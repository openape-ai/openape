// Follow-up to the isActive enforcement on the login paths (#1144):
// account recovery is permission-to-enrol a NEW credential. A deactivated
// account must not be recoverable — otherwise deactivation is undone by
// a mail link. Cancel stays open on purpose: it is the active-owner veto,
// can only kill a pending recovery and never authenticates.

import { InMemoryRecoveryStore } from '@openape/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const DAY = 24 * 60 * 60 * 1000
const EMAIL = 'owner@example.com'

const readBodyMock = vi.fn()
const consumeChallengeMock = vi.fn()
const saveChallengeMock = vi.fn()
const findUserByEmailMock = vi.fn()
const createUserMock = vi.fn()
const deleteAllForUserMock = vi.fn()
const saveCredentialMock = vi.fn()
const sessionClearMock = vi.fn()
const verifyRegistrationMock = vi.fn()
const createRegistrationOptionsMock = vi.fn()

let recoveryStore: InMemoryRecoveryStore

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  readBody: (...args: any[]) => readBodyMock(...args),
}))

vi.mock('@openape/auth', async importOriginal => ({
  ...(await importOriginal<object>()),
  createRegistrationOptions: (...args: any[]) => createRegistrationOptionsMock(...args),
  verifyRegistration: (...args: any[]) => verifyRegistrationMock(...args),
}))

vi.mock('../src/runtime/server/utils/session', () => ({
  getAppSession: vi.fn(async () => ({ data: {}, clear: sessionClearMock, update: vi.fn() })),
}))

vi.mock('../src/runtime/server/utils/rp-config', () => ({
  getRPConfig: () => ({ rpID: 'id.openape.ai' }),
}))

vi.mock('../src/runtime/server/utils/stores', () => ({
  useIdpStores: () => ({
    recoveryStore,
    challengeStore: { consume: consumeChallengeMock, save: saveChallengeMock },
    credentialStore: { deleteAllForUser: deleteAllForUserMock, save: saveCredentialMock },
    userStore: { findByEmail: findUserByEmailMock, create: createUserMock },
  }),
}))

vi.mock('../src/runtime/server/utils/problem', () => ({
  createProblemError: (opts: any) =>
    Object.assign(new Error(opts.title), { statusCode: opts.status, data: opts }),
}))

function makeUsableToken() {
  const now = Date.now()
  return {
    token: 'rec-1',
    email: EMAIL,
    createdAt: now - 8 * DAY,
    usableAt: now - DAY,
    expiresAt: now + 13 * DAY,
    cancelled: false,
    consumed: false,
  }
}

beforeEach(() => {
  recoveryStore = new InMemoryRecoveryStore()
  readBodyMock.mockReset()
  consumeChallengeMock.mockReset()
  saveChallengeMock.mockReset()
  findUserByEmailMock.mockReset().mockResolvedValue({ email: EMAIL, name: 'Owner', isActive: false })
  createUserMock.mockReset()
  deleteAllForUserMock.mockReset()
  saveCredentialMock.mockReset()
  sessionClearMock.mockReset()
  verifyRegistrationMock.mockReset()
  createRegistrationOptionsMock.mockReset().mockResolvedValue({ options: {}, challenge: 'chal' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('recovery — deactivated account', () => {
  it('options refuses a deactivated account (403)', async () => {
    await recoveryStore.save(makeUsableToken())
    readBodyMock.mockResolvedValue({ token: 'rec-1' })

    const handler = (await import('../src/runtime/server/api/recovery/options.post')).default
    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 403,
      message: 'User is inactive',
    })
    expect(saveChallengeMock).not.toHaveBeenCalled()
  })

  it('verify refuses a deactivated account (403) without touching credentials', async () => {
    await recoveryStore.save(makeUsableToken())
    readBodyMock.mockResolvedValue({ token: 'rec-1', challengeToken: 'ct-1', response: {} })
    consumeChallengeMock.mockResolvedValue({
      challenge: 'chal',
      userEmail: EMAIL,
      type: 'registration',
      expiresAt: Date.now() + 60_000,
      rpId: 'id.openape.ai',
    })
    verifyRegistrationMock.mockResolvedValue({ verified: true, credential: { credentialId: 'cred-1' } })

    const handler = (await import('../src/runtime/server/api/recovery/verify.post')).default
    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 403,
      message: 'User is inactive',
    })
    expect(deleteAllForUserMock).not.toHaveBeenCalled()
    expect(saveCredentialMock).not.toHaveBeenCalled()
  })

  it('cancel keeps working for a deactivated account (active-owner veto)', async () => {
    await recoveryStore.save(makeUsableToken())
    readBodyMock.mockResolvedValue({ token: 'rec-1' })

    const handler = (await import('../src/runtime/server/api/recovery/cancel.post')).default
    const result = await handler({} as any)

    expect(result).toMatchObject({ ok: true, cancelled: 1 })
  })
})
