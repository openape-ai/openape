import { beforeEach, describe, expect, it, vi } from 'vitest'

// Regression: GET /api/grants?requester= must NOT leak another user's grants
// without authentication/authorization. The handler previously short-circuited
// on the `requester` query param BEFORE any auth check.

const queryMock = vi.fn()
const bearerMock = vi.fn()
const sessionMock = vi.fn()
const listGrantsMock = vi.fn(async () => ({ data: [], pagination: { cursor: null, has_more: false } }))
const findByOwnerMock = vi.fn(async () => [] as Array<{ email: string }>)
const findByApproverMock = vi.fn(async () => [] as Array<{ email: string }>)

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  getQuery: (...a: any[]) => queryMock(...a),
  createError: (opts: any) => Object.assign(new Error(opts.message ?? opts.statusMessage), { statusCode: opts.statusCode }),
}))
vi.mock('../src/runtime/server/utils/agent-auth', () => ({ tryBearerAuth: (...a: any[]) => bearerMock(...a) }))
vi.mock('../src/runtime/server/utils/grant-stores', () => ({ useGrantStores: () => ({ grantStore: { listGrants: listGrantsMock } }) }))
vi.mock('../src/runtime/server/utils/session', () => ({ getAppSession: (...a: any[]) => sessionMock(...a) }))
vi.mock('../src/runtime/server/utils/stores', () => ({ useIdpStores: () => ({ userStore: { findByOwner: findByOwnerMock, findByApprover: findByApproverMock } }) }))

const handler = (await import('../src/runtime/server/api/grants/index.get')).default

describe('GET /api/grants — requester authorization', () => {
  beforeEach(() => {
    queryMock.mockReset()
    bearerMock.mockReset().mockResolvedValue(null)
    sessionMock.mockReset().mockRejectedValue(new Error('no session'))
    listGrantsMock.mockClear()
    findByOwnerMock.mockReset().mockResolvedValue([])
    findByApproverMock.mockReset().mockResolvedValue([])
  })

  it('rejects ?requester= with no auth (the leak)', async () => {
    queryMock.mockReturnValue({ requester: 'victim@example.com' })
    await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 401 })
    expect(listGrantsMock).not.toHaveBeenCalled()
  })

  it('rejects ?requester= for a requester the caller does not own (403)', async () => {
    queryMock.mockReturnValue({ requester: 'foreign@example.com' })
    bearerMock.mockResolvedValue({ sub: 'patrick@hofmann.eco' })
    await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 403 })
    expect(listGrantsMock).not.toHaveBeenCalled()
  })

  it('allows ?requester= for an agent the caller owns', async () => {
    queryMock.mockReturnValue({ requester: 'agent@hofmann.eco' })
    bearerMock.mockResolvedValue({ sub: 'patrick@hofmann.eco' })
    findByOwnerMock.mockResolvedValue([{ email: 'agent@hofmann.eco' }])
    await handler({} as any)
    expect(listGrantsMock).toHaveBeenCalledWith(expect.objectContaining({ requester: 'agent@hofmann.eco' }))
  })

  it('allows ?requester=self', async () => {
    queryMock.mockReturnValue({ requester: 'patrick@hofmann.eco' })
    bearerMock.mockResolvedValue({ sub: 'patrick@hofmann.eco' })
    await handler({} as any)
    expect(listGrantsMock).toHaveBeenCalledWith(expect.objectContaining({ requester: 'patrick@hofmann.eco' }))
  })
})
