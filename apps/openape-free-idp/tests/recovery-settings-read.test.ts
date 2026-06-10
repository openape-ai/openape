// story: recovery-adaptive-cooldown
//
// Read counterpart of the vacation settings (criterion 4 surface): the
// account UI shows the signed-in owner's settings — and only theirs.
//
//   handler  apps/openape-free-idp/server/api/settings/recovery.get.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requireAuthMock = vi.fn()
const findByEmailMock = vi.fn()

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), opts),
}))

beforeEach(() => {
  requireAuthMock.mockReset().mockResolvedValue('alice@example.com')
  findByEmailMock.mockReset()
  vi.stubGlobal('requireAuth', requireAuthMock)
  vi.stubGlobal('useIdpStores', () => ({
    userStore: { findByEmail: findByEmailMock },
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function importHandler() {
  return (await import('../server/api/settings/recovery.get')).default
}

describe('recovery vacation settings read — owner-only (issue #462)', () => {
  it('rejects unauthenticated reads', async () => {
    requireAuthMock.mockRejectedValue(Object.assign(new Error('Authentication required'), { statusCode: 401 }))

    const handler = await importHandler()
    await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 401 })
    expect(findByEmailMock).not.toHaveBeenCalled()
  })

  it('returns the signed-in owner\'s settings', async () => {
    findByEmailMock.mockResolvedValue({
      email: 'alice@example.com',
      name: 'Alice',
      isActive: true,
      createdAt: 1,
      recoveryVacationMode: true,
      recoveryVacationDays: 10,
    })

    const handler = await importHandler()
    await expect(handler({} as any)).resolves.toEqual({ vacationMode: true, vacationDays: 10 })
    expect(findByEmailMock).toHaveBeenCalledWith('alice@example.com')
  })

  it('defaults to vacation off / 14 days when nothing is stored', async () => {
    findByEmailMock.mockResolvedValue({
      email: 'alice@example.com',
      name: 'Alice',
      isActive: true,
      createdAt: 1,
    })

    const handler = await importHandler()
    await expect(handler({} as any)).resolves.toEqual({ vacationMode: false, vacationDays: 14 })
  })
})
