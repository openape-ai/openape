import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Pin the security gate added in PR for #291: the unauthenticated
// mail-token-only register flow refuses to APPEND credentials to a
// user that already has passkeys. The remaining legitimate use is
// first-time enrolment only.

const readBodyMock = vi.fn()
const findRegUrlMock = vi.fn()
const consumeRegUrlMock = vi.fn()
const consumeChallengeMock = vi.fn()
const findUserByEmailMock = vi.fn()
const createUserMock = vi.fn()
const findCredentialsByUserMock = vi.fn()
const saveCredentialMock = vi.fn()
const updateSessionMock = vi.fn()
const verifyRegistrationMock = vi.fn()

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  readBody: (...args: any[]) => readBodyMock(...args),
}))

vi.mock('@openape/auth', () => ({
  verifyRegistration: (...args: any[]) => verifyRegistrationMock(...args),
}))

vi.mock('../src/runtime/server/utils/session', () => ({
  getAppSession: vi.fn(async () => ({ update: updateSessionMock })),
}))

vi.mock('../src/runtime/server/utils/rp-config', () => ({
  getRPConfig: () => ({ rpID: 'id.openape.ai' }),
}))

vi.mock('../src/runtime/server/utils/stores', () => ({
  useIdpStores: () => ({
    registrationUrlStore: {
      find: findRegUrlMock,
      consume: consumeRegUrlMock,
    },
    challengeStore: {
      consume: consumeChallengeMock,
    },
    credentialStore: {
      findByUser: findCredentialsByUserMock,
      save: saveCredentialMock,
    },
    userStore: {
      findByEmail: findUserByEmailMock,
      create: createUserMock,
    },
  }),
}))

vi.mock('../src/runtime/server/utils/problem', () => ({
  createProblemError: (opts: any) =>
    Object.assign(new Error(opts.title), { statusCode: opts.status, data: opts }),
}))

beforeEach(() => {
  readBodyMock.mockReset().mockResolvedValue({
    token: 'reg-tok',
    challengeToken: 'chal-tok',
    response: { id: 'cred', rawId: 'cred', type: 'public-key', response: {} },
  })
  findRegUrlMock.mockReset().mockResolvedValue({
    token: 'reg-tok', email: 'patrick@hofmann.eco', name: 'Patrick',
  })
  consumeRegUrlMock.mockReset()
  consumeChallengeMock.mockReset().mockResolvedValue({
    challenge: 'abc', rpId: 'id.openape.ai',
  })
  findUserByEmailMock.mockReset()
  createUserMock.mockReset()
  findCredentialsByUserMock.mockReset()
  saveCredentialMock.mockReset()
  updateSessionMock.mockReset()
  verifyRegistrationMock.mockReset().mockResolvedValue({
    verified: true,
    credential: { credentialId: 'cred-id' },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function importHandler() {
  return (await import('../src/runtime/server/api/webauthn/register/verify.post')).default
}

describe('webauthn register verify — security gate (#291)', () => {
  it('allows first-time enrolment (no existing user)', async () => {
    findUserByEmailMock.mockResolvedValue(null)
    findCredentialsByUserMock.mockResolvedValue([])

    const handler = await importHandler()
    const result = await handler({} as any)

    expect(result).toMatchObject({ ok: true, email: 'patrick@hofmann.eco' })
    expect(createUserMock).toHaveBeenCalled()
    expect(saveCredentialMock).toHaveBeenCalled()
    expect(consumeRegUrlMock).toHaveBeenCalledWith('reg-tok')
  })

  it('allows enrolment for an existing user with zero credentials (legacy import case)', async () => {
    // A user record imported from another provider may exist before any
    // credential is enrolled. That's still first-time enrolment for the
    // passkey itself, so we let it through.
    findUserByEmailMock.mockResolvedValue({ email: 'patrick@hofmann.eco' })
    findCredentialsByUserMock.mockResolvedValue([])

    const handler = await importHandler()
    const result = await handler({} as any)

    expect(result.ok).toBe(true)
    expect(saveCredentialMock).toHaveBeenCalled()
  })

  it('REFUSES adding a credential to an account that already has passkeys', async () => {
    // The passkey-graft path: attacker holds a registration token (got
    // it via mailbox compromise), tries to attach their key to the
    // victim's account. Now blocked at 409 — they have to either go
    // through the authenticated add-device flow (impossible without a
    // session) or the recovery flow (72h cooldown, broadcast to all
    // existing devices).
    findUserByEmailMock.mockResolvedValue({ email: 'patrick@hofmann.eco' })
    findCredentialsByUserMock.mockResolvedValue([
      { credentialId: 'existing-cred-1', rpId: 'id.openape.ai' },
    ])

    const handler = await importHandler()
    await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 409 })

    expect(saveCredentialMock).not.toHaveBeenCalled()
    expect(consumeRegUrlMock).not.toHaveBeenCalled() // token stays valid
    expect(updateSessionMock).not.toHaveBeenCalled() // no session minted
  })

  it('refuses even with a single existing credential (no minimum threshold)', async () => {
    findUserByEmailMock.mockResolvedValue({ email: 'patrick@hofmann.eco' })
    findCredentialsByUserMock.mockResolvedValue([
      { credentialId: 'lone-cred', rpId: 'someother-rp.example' },
    ])

    const handler = await importHandler()
    await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 409 })
    expect(saveCredentialMock).not.toHaveBeenCalled()
  })
})
