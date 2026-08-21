import { beforeEach, describe, expect, it, vi } from 'vitest'

// Expiry is enforced lazily — the stored status stays 'approved' until
// something introspects a grant by id. Every listing therefore has to apply
// the rule itself. `ensure-delegations` reads the delegation list to decide
// whether to renew, so a dead grant reported as approved means it renews
// never, not late: nothing else ever touches it to flip the stored status.

const NOW = Math.floor(Date.now() / 1000)

function timedGrant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g-1',
    status: 'approved',
    created_at: NOW - 100,
    expires_at: NOW - 1,
    request: {
      requester: 'patrick@hofmann.eco',
      audience: 'troop.openape.ai',
      grant_type: 'timed',
      delegate: 'op-delta-mind@id.openape.ai',
    },
    ...overrides,
  }
}

const queryMock = vi.fn()
const bearerMock = vi.fn()
const sessionMock = vi.fn()
const listGrantsMock = vi.fn()
const findByDelegatorMock = vi.fn()
const findByDelegateMock = vi.fn()
const requireAuthMock = vi.fn()
const updateStatusMock = vi.fn(async () => {})

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  getQuery: (...a: any[]) => queryMock(...a),
  createError: (opts: any) => Object.assign(new Error(opts.message ?? opts.statusMessage), { statusCode: opts.statusCode }),
}))
vi.mock('../src/runtime/server/utils/agent-auth', () => ({ tryBearerAuth: (...a: any[]) => bearerMock(...a) }))
vi.mock('../src/runtime/server/utils/session', () => ({ getAppSession: (...a: any[]) => sessionMock(...a) }))
vi.mock('../src/runtime/server/utils/stores', () => ({
  useIdpStores: () => ({ userStore: { findByOwner: async () => [], findByApprover: async () => [] } }),
}))
vi.mock('../src/runtime/server/utils/admin', () => ({ requireAuth: (...a: any[]) => requireAuthMock(...a) }))
vi.mock('../src/runtime/server/utils/grant-stores', () => ({
  useGrantStores: () => ({
    grantStore: {
      listGrants: listGrantsMock,
      findByDelegator: findByDelegatorMock,
      findByDelegate: findByDelegateMock,
      updateStatus: updateStatusMock,
    },
  }),
}))

const grantsHandler = (await import('../src/runtime/server/api/grants/index.get')).default
const delegationsHandler = (await import('../src/runtime/server/api/delegations/index.get')).default

describe('listings report an expired grant as expired', () => {
  beforeEach(() => {
    queryMock.mockReset()
    bearerMock.mockReset().mockResolvedValue({ sub: 'patrick@hofmann.eco' })
    sessionMock.mockReset().mockRejectedValue(new Error('no session'))
    listGrantsMock.mockReset()
    findByDelegatorMock.mockReset()
    findByDelegateMock.mockReset()
    requireAuthMock.mockReset().mockResolvedValue('patrick@hofmann.eco')
    updateStatusMock.mockClear()
  })

  it('keeps an expired grant out of "active" and files it under history', async () => {
    listGrantsMock.mockResolvedValue({ data: [timedGrant()], pagination: { cursor: null, has_more: false } })

    queryMock.mockReturnValue({ section: 'active' })
    const active = await grantsHandler({} as any)
    expect(active.data).toEqual([])

    queryMock.mockReturnValue({ section: 'history' })
    const history = await grantsHandler({} as any)
    expect(history.data).toHaveLength(1)
    expect(history.data[0].status).toBe('expired')
  })

  it('persists the transition, as grants.md §5 requires ("MUST transition ... before returning")', async () => {
    listGrantsMock.mockResolvedValue({ data: [timedGrant()], pagination: { cursor: null, has_more: false } })
    queryMock.mockReturnValue({ section: 'active' })

    await grantsHandler({} as any)

    expect(updateStatusMock).toHaveBeenCalledWith('g-1', 'expired')
  })

  it('writes nothing for a grant that is still live', async () => {
    listGrantsMock.mockResolvedValue({
      data: [timedGrant({ expires_at: NOW + 3600 })],
      pagination: { cursor: null, has_more: false },
    })
    queryMock.mockReturnValue({ section: 'active' })

    await grantsHandler({} as any)

    expect(updateStatusMock).not.toHaveBeenCalled()
  })

  it('leaves a grant that is still within its deadline alone', async () => {
    listGrantsMock.mockResolvedValue({
      data: [timedGrant({ expires_at: NOW + 3600 })],
      pagination: { cursor: null, has_more: false },
    })
    queryMock.mockReturnValue({ section: 'active' })

    const active = await grantsHandler({} as any)
    expect(active.data).toHaveLength(1)
    expect(active.data[0].status).toBe('approved')
  })

  it('reports an expired delegation as expired — this is what ensure-delegations reads', async () => {
    findByDelegatorMock.mockResolvedValue([timedGrant()])
    queryMock.mockReturnValue({ role: 'delegator' })

    const res = await delegationsHandler({} as any)
    expect(res.data).toHaveLength(1)
    // active_for() counts anything 'approved' as present; with the stale
    // status it would keep the dead delegation forever and never renew.
    expect(res.data[0].status).toBe('expired')
  })

  it('leaves a live delegation approved', async () => {
    findByDelegatorMock.mockResolvedValue([timedGrant({ expires_at: NOW + 86400 })])
    queryMock.mockReturnValue({ role: 'delegator' })

    const res = await delegationsHandler({} as any)
    expect(res.data[0].status).toBe('approved')
  })
})
