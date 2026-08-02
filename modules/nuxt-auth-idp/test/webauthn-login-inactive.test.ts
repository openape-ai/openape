import { beforeEach, describe, expect, it, vi } from 'vitest'

// Security checklist: deactivated users must not be able to log in via
// passkeys. Both WebAuthn login routes enforce user.isActive — options
// refuses to hand out authentication options, verify refuses the session.

const readBodyMock = vi.fn()
const consumeChallengeMock = vi.fn()
const saveChallengeMock = vi.fn()
const findUserByEmailMock = vi.fn()
const updateUserMock = vi.fn()
const findCredentialsByUserMock = vi.fn()
const findCredentialByIdMock = vi.fn()
const updateCounterMock = vi.fn()
const cancelRecoveryMock = vi.fn()
const updateSessionMock = vi.fn()
const verifyAuthenticationMock = vi.fn()
const createAuthenticationOptionsMock = vi.fn()

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  readBody: (...args: any[]) => readBodyMock(...args),
}))

vi.mock('@openape/auth', () => ({
  verifyAuthentication: (...args: any[]) => verifyAuthenticationMock(...args),
  createAuthenticationOptions: (...args: any[]) => createAuthenticationOptionsMock(...args),
}))

vi.mock('../src/runtime/server/utils/session', () => ({
  getAppSession: vi.fn(async () => ({ update: updateSessionMock })),
}))

vi.mock('../src/runtime/server/utils/rp-config', () => ({
  getRPConfig: () => ({ rpID: 'id.openape.test' }),
}))

vi.mock('../src/runtime/server/utils/stores', () => ({
  useIdpStores: () => ({
    challengeStore: {
      consume: consumeChallengeMock,
      save: saveChallengeMock,
    },
    credentialStore: {
      findByUser: findCredentialsByUserMock,
      findById: findCredentialByIdMock,
      updateCounter: updateCounterMock,
    },
    userStore: {
      findByEmail: findUserByEmailMock,
      update: updateUserMock,
    },
    recoveryStore: {
      cancelAllForEmail: cancelRecoveryMock,
    },
  }),
}))

vi.mock('../src/runtime/server/utils/problem', () => ({
  createProblemError: (opts: any) =>
    Object.assign(new Error(opts.title), { statusCode: opts.status, statusMessage: opts.title, data: opts }),
}))

const USER = 'human@example.com'
const CREDENTIAL = {
  credentialId: 'cred-1',
  userEmail: USER,
  publicKey: 'pk',
  counter: 0,
  rpId: 'id.openape.test',
}

beforeEach(() => {
  vi.clearAllMocks()
  createAuthenticationOptionsMock.mockResolvedValue({ options: { rpId: 'id.openape.test' }, challenge: 'chal' })
  verifyAuthenticationMock.mockResolvedValue({ verified: true, newCounter: 1 })
  consumeChallengeMock.mockResolvedValue({
    challenge: 'chal',
    userEmail: USER,
    type: 'authentication',
    rpId: 'id.openape.test',
  })
  findCredentialsByUserMock.mockResolvedValue([CREDENTIAL])
  findCredentialByIdMock.mockResolvedValue(CREDENTIAL)
  cancelRecoveryMock.mockResolvedValue(0)
})

describe('webauthn login and deactivated users', () => {
  it('options refuses a deactivated user', async () => {
    readBodyMock.mockResolvedValue({ email: USER })
    findUserByEmailMock.mockResolvedValue({ email: USER, name: 'Test', isActive: false })

    const { default: handler } = await import('../src/runtime/server/api/webauthn/login/options.post')
    await expect(handler({} as any))
      .rejects
      .toMatchObject({ statusCode: 403, statusMessage: 'User is inactive' })
    expect(saveChallengeMock).not.toHaveBeenCalled()
  })

  it('options still serves an active user', async () => {
    readBodyMock.mockResolvedValue({ email: USER })
    findUserByEmailMock.mockResolvedValue({ email: USER, name: 'Test', isActive: true })

    const { default: handler } = await import('../src/runtime/server/api/webauthn/login/options.post')
    const result = await handler({} as any)
    expect(result.challengeToken).toBeDefined()
    expect(saveChallengeMock).toHaveBeenCalled()
  })

  it('verify refuses a session for a deactivated user', async () => {
    readBodyMock.mockResolvedValue({ challengeToken: 'tok', response: { id: 'cred-1' } })
    findUserByEmailMock.mockResolvedValue({ email: USER, name: 'Test', isActive: false })

    const { default: handler } = await import('../src/runtime/server/api/webauthn/login/verify.post')
    await expect(handler({} as any))
      .rejects
      .toMatchObject({ statusCode: 403, statusMessage: 'User is inactive' })
    expect(updateSessionMock).not.toHaveBeenCalled()
  })

  it('verify still logs in an active user', async () => {
    readBodyMock.mockResolvedValue({ challengeToken: 'tok', response: { id: 'cred-1' } })
    findUserByEmailMock.mockResolvedValue({ email: USER, name: 'Test', isActive: true })
    updateUserMock.mockResolvedValue({})

    const { default: handler } = await import('../src/runtime/server/api/webauthn/login/verify.post')
    const result = await handler({} as any)
    expect(result).toMatchObject({ ok: true, email: USER })
    expect(updateSessionMock).toHaveBeenCalledWith({ userId: USER, userName: 'Test' })
  })
})
