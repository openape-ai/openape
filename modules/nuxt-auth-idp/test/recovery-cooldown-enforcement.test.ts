// story: recovery-adaptive-cooldown
//
// Criteria 5 + 7: the waiting period is binding from the moment of the
// request — options/verify enforce the STORED usableAt and never recompute
// it from current account state — and completing a recovery never creates
// a session (permission-to-enrol only).

import { InMemoryRecoveryStore } from '@openape/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const EMAIL = 'owner@example.com'

const readBodyMock = vi.fn()
const consumeChallengeMock = vi.fn()
const saveChallengeMock = vi.fn()
const findUserByEmailMock = vi.fn()
const createUserMock = vi.fn()
const deleteAllForUserMock = vi.fn()
const saveCredentialMock = vi.fn()
const sessionClearMock = vi.fn()
const sessionUpdateMock = vi.fn()
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
  getAppSession: vi.fn(async () => ({ data: {}, clear: sessionClearMock, update: sessionUpdateMock })),
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

function makeToken(overrides: Record<string, unknown> = {}) {
  const now = Date.now()
  return {
    token: 'rec-1',
    email: EMAIL,
    createdAt: now,
    usableAt: now + 7 * DAY,
    expiresAt: now + 21 * DAY,
    cancelled: false,
    consumed: false,
    ...overrides,
  }
}

beforeEach(() => {
  recoveryStore = new InMemoryRecoveryStore()
  readBodyMock.mockReset()
  consumeChallengeMock.mockReset()
  saveChallengeMock.mockReset()
  findUserByEmailMock.mockReset().mockResolvedValue({ email: EMAIL, name: 'Owner' })
  createUserMock.mockReset()
  deleteAllForUserMock.mockReset()
  saveCredentialMock.mockReset()
  sessionClearMock.mockReset()
  sessionUpdateMock.mockReset()
  verifyRegistrationMock.mockReset()
  createRegistrationOptionsMock.mockReset().mockResolvedValue({ options: {}, challenge: 'chal' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function optionsHandler() {
  return (await import('../src/runtime/server/api/recovery/options.post')).default
}

async function verifyHandler() {
  return (await import('../src/runtime/server/api/recovery/verify.post')).default
}

describe('recovery deadline enforcement (issue #462)', () => {
  // story: recovery-adaptive-cooldown — criterion 5
  it('enforces the STORED deadline — later account-state changes cannot shorten it', async () => {
    // The deadline was fixed at request time (7d, owner was active). Even if
    // the account would NOW yield a shorter wait (owner inactive, vacation
    // off), the stored usableAt rules.
    await recoveryStore.save(makeToken({ usableAt: Date.now() + 5 * DAY }) as any)
    findUserByEmailMock.mockResolvedValue({ email: EMAIL, name: 'Owner', lastLoginAt: 0 })
    readBodyMock.mockResolvedValue({ token: 'rec-1' })

    const handler = await optionsHandler()
    await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 425 })
    expect(saveChallengeMock).not.toHaveBeenCalled()
  })

  // story: recovery-adaptive-cooldown — criterion 7
  it('refuses to complete a recovery before the deadline', async () => {
    await recoveryStore.save(makeToken({ usableAt: Date.now() + 1 * HOUR }) as any)
    readBodyMock.mockResolvedValue({ token: 'rec-1', challengeToken: 'chal-1', response: {} })

    const handler = await verifyHandler()
    await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 425 })
    expect(saveCredentialMock).not.toHaveBeenCalled()
  })

  // story: recovery-adaptive-cooldown — criterion 7
  it('completing a recovery never creates a session — it only enrols a new passkey', async () => {
    await recoveryStore.save(makeToken({ usableAt: Date.now() - 1 * HOUR }) as any)
    readBodyMock.mockResolvedValue({ token: 'rec-1', challengeToken: 'chal-1', response: {} })
    consumeChallengeMock.mockResolvedValue({ challenge: 'abc', rpId: 'id.openape.ai', userEmail: EMAIL })
    verifyRegistrationMock.mockResolvedValue({ verified: true, credential: { credentialId: 'new-cred' } })

    const handler = await verifyHandler()
    const result = await handler({} as any)

    expect(saveCredentialMock).toHaveBeenCalled()
    expect(sessionUpdateMock).not.toHaveBeenCalled()
    expect(sessionClearMock).toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toMatch(/access_token|session/)
  })
})
