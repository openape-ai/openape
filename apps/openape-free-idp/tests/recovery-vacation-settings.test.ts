// story: recovery-adaptive-cooldown
//
// Criteria 3 + 4: the vacation switch and its duration are settable ONLY by
// the signed-in account owner, and never above the 14-day cap.
//
// Pins the settings surface for the green phase:
//   handler  apps/openape-free-idp/server/api/settings/recovery.put.ts
//   auth     global `requireAuth(event)` (module util, auto-imported) → owner email
//   persist  useIdpStores().userStore.update(<owner email>, { recoveryVacationMode, recoveryVacationDays })

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const readBodyMock = vi.fn()
const updateUserMock = vi.fn()
const requireAuthMock = vi.fn()

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), opts),
  readBody: (...args: any[]) => readBodyMock(...args),
}))

beforeEach(() => {
  readBodyMock.mockReset()
  updateUserMock.mockReset()
  requireAuthMock.mockReset().mockResolvedValue('alice@example.com')
  vi.stubGlobal('requireAuth', requireAuthMock)
  vi.stubGlobal('useIdpStores', () => ({
    userStore: {
      update: updateUserMock,
      findByEmail: async () => ({ email: 'alice@example.com', name: 'Alice', isActive: true, createdAt: 1 }),
    },
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function importHandler() {
  return (await import('../server/api/settings/recovery.put')).default
}

describe('recovery vacation settings — owner-only, 14-day cap (issue #462)', () => {
  // story: recovery-adaptive-cooldown — criterion 4
  it('rejects unauthenticated changes', async () => {
    requireAuthMock.mockRejectedValue(Object.assign(new Error('Authentication required'), { statusCode: 401 }))
    readBodyMock.mockResolvedValue({ vacationMode: true })

    const handler = await importHandler()
    await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 401 })
    expect(updateUserMock).not.toHaveBeenCalled()
  })

  // story: recovery-adaptive-cooldown — criterion 4
  it('applies changes to the signed-in owner only — never to a body-supplied account', async () => {
    readBodyMock.mockResolvedValue({ email: 'victim@example.com', vacationMode: true, vacationDays: 14 })

    const handler = await importHandler()
    await handler({} as any)

    expect(updateUserMock).toHaveBeenCalledTimes(1)
    expect(updateUserMock.mock.calls[0][0]).toBe('alice@example.com')
  })

  // story: recovery-adaptive-cooldown — criterion 3
  it('refuses a vacation wait above 14 days', async () => {
    readBodyMock.mockResolvedValue({ vacationMode: true, vacationDays: 21 })

    const handler = await importHandler()
    await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 400 })
    expect(updateUserMock).not.toHaveBeenCalled()
  })

  // story: recovery-adaptive-cooldown — criteria 3 + 4
  it('lets the owner switch vacation mode on with a duration up to 14 days', async () => {
    readBodyMock.mockResolvedValue({ vacationMode: true, vacationDays: 14 })

    const handler = await importHandler()
    await handler({} as any)

    expect(updateUserMock).toHaveBeenCalledWith(
      'alice@example.com',
      expect.objectContaining({ recoveryVacationMode: true, recoveryVacationDays: 14 }),
    )
  })
})
