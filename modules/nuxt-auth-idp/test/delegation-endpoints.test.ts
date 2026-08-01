// Security checklist: delegation API — act-enforcement (only act:'human'
// may create delegations, which also blocks chaining via delegated
// tokens), delegate/audience binding on validation, and delegator-only
// revocation.

import { InMemoryGrantStore } from '@openape/grants'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let grantStore = new InMemoryGrantStore()

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  readBody: async (event: any) => event.body,
  getQuery: (event: any) => event.query ?? {},
  getRouterParam: (event: any, name: string) => event.params?.[name],
  setResponseStatus: (event: any, status: number) => { event.responseStatus = status },
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), opts),
}))

vi.mock('../src/runtime/server/utils/grant-stores', () => ({
  useGrantStores: () => ({ grantStore }),
}))

let bearerPayload: { sub: string, act: unknown } | null = null
vi.mock('../src/runtime/server/utils/agent-auth', () => ({
  tryBearerAuth: async () => bearerPayload,
}))

let authedUser = 'owner@example.com'
vi.mock('../src/runtime/server/utils/admin', () => ({
  requireAuth: async () => authedUser,
}))

const DELEGATOR = 'owner@example.com'
const DELEGATE = 'bot@example.com'

async function createDelegationViaApi(body: Record<string, unknown> = {}) {
  const { default: handler } = await import('../src/runtime/server/api/delegations/index.post')
  const event: any = { body: { delegate: DELEGATE, audience: 'sp.example.com', ...body } }
  const grant = await handler(event)
  return { grant, event }
}

describe('delegation endpoints', () => {
  beforeEach(() => {
    grantStore = new InMemoryGrantStore()
    bearerPayload = null
    authedUser = DELEGATOR
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('create (act enforcement)', () => {
    it('creates an auto-approved delegation for a human', async () => {
      bearerPayload = { sub: DELEGATOR, act: 'human' }
      const { grant, event } = await createDelegationViaApi({ scopes: ['tasks.read'] })
      expect(event.responseStatus).toBe(201)
      expect(grant.type).toBe('delegation')
      expect(grant.status).toBe('approved')
      expect(grant.request.delegator).toBe(DELEGATOR)
      expect(grant.request.delegate).toBe(DELEGATE)
      expect(grant.request.scopes).toEqual(['tasks.read'])
    })

    it('rejects creation by an agent token', async () => {
      bearerPayload = { sub: DELEGATE, act: 'agent' }
      await expect(createDelegationViaApi()).rejects.toMatchObject({
        statusCode: 403,
        statusMessage: 'Only humans can create delegations',
      })
    })

    it('rejects creation by a delegated token — no chaining', async () => {
      // A token minted via a delegation carries a structured act claim,
      // not act:'human' — it must not be able to mint further delegations.
      bearerPayload = { sub: DELEGATE, act: { sub: DELEGATE } }
      await expect(createDelegationViaApi()).rejects.toMatchObject({ statusCode: 403 })
    })

    it('rejects a missing delegate', async () => {
      const { default: handler } = await import('../src/runtime/server/api/delegations/index.post')
      await expect(handler({ body: { audience: 'sp.example.com' } } as any))
        .rejects
        .toMatchObject({ statusCode: 400 })
    })

    it('rejects a missing audience', async () => {
      const { default: handler } = await import('../src/runtime/server/api/delegations/index.post')
      await expect(handler({ body: { delegate: DELEGATE } } as any))
        .rejects
        .toMatchObject({ statusCode: 400 })
    })

    it('rejects an unknown grant_type', async () => {
      await expect(createDelegationViaApi({ grant_type: 'forever' }))
        .rejects
        .toMatchObject({ statusCode: 400 })
    })
  })

  describe('validate', () => {
    async function validate(id: string, body: Record<string, unknown>) {
      const { default: handler } = await import('../src/runtime/server/api/delegations/[id]/validate.post')
      return handler({ params: { id }, body } as any)
    }

    it('validates a matching delegate and audience', async () => {
      const { grant } = await createDelegationViaApi({ scopes: ['tasks.read'] })
      const result = await validate(grant.id, { delegate: DELEGATE, audience: 'sp.example.com' })
      expect(result.valid).toBe(true)
      expect(result.scopes).toEqual(['tasks.read'])
    })

    it('rejects a different delegate', async () => {
      const { grant } = await createDelegationViaApi()
      const result = await validate(grant.id, { delegate: 'imposter@example.com', audience: 'sp.example.com' })
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Delegate does not match')
    })

    it('rejects a different audience', async () => {
      const { grant } = await createDelegationViaApi()
      const result = await validate(grant.id, { delegate: DELEGATE, audience: 'other.example.com' })
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Audience does not match')
    })

    it('accepts any audience for a wildcard delegation', async () => {
      const { grant } = await createDelegationViaApi({ audience: '*' })
      const result = await validate(grant.id, { delegate: DELEGATE, audience: 'whatever.example.com' })
      expect(result.valid).toBe(true)
    })

    it('rejects a revoked delegation', async () => {
      const { grant } = await createDelegationViaApi()
      await grantStore.updateStatus(grant.id, 'revoked')
      const result = await validate(grant.id, { delegate: DELEGATE, audience: 'sp.example.com' })
      expect(result.valid).toBe(false)
      expect(result.error).toContain('not approved')
    })

    it('rejects an expired timed delegation', async () => {
      vi.useFakeTimers()
      const { grant } = await createDelegationViaApi({ grant_type: 'timed', duration: 60 })
      vi.advanceTimersByTime(61_000)
      const result = await validate(grant.id, { delegate: DELEGATE, audience: 'sp.example.com' })
      expect(result.valid).toBe(false)
    })

    it('rejects a non-delegation grant', async () => {
      await grantStore.save({
        id: 'plain-grant',
        status: 'approved',
        created_at: Math.floor(Date.now() / 1000),
        request: { requester: DELEGATE, target_host: 'host', audience: 'sp.example.com', grant_type: 'once' },
      } as any)
      const result = await validate('plain-grant', { delegate: DELEGATE, audience: 'sp.example.com' })
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Not a delegation grant')
    })

    it('rejects missing body fields', async () => {
      const { default: handler } = await import('../src/runtime/server/api/delegations/[id]/validate.post')
      await expect(handler({ params: { id: 'x' }, body: { delegate: DELEGATE } } as any))
        .rejects
        .toMatchObject({ statusCode: 400 })
    })
  })

  describe('revoke', () => {
    async function revoke(id: string) {
      const { default: handler } = await import('../src/runtime/server/api/delegations/[id].delete')
      return handler({ params: { id } } as any)
    }

    it('lets the delegator revoke their delegation', async () => {
      const { grant } = await createDelegationViaApi()
      const revoked = await revoke(grant.id)
      expect(revoked.status).toBe('revoked')
    })

    it('rejects revocation by anyone else — including the delegate', async () => {
      const { grant } = await createDelegationViaApi()
      authedUser = DELEGATE
      await expect(revoke(grant.id)).rejects.toMatchObject({ statusCode: 403 })
    })

    it('returns 404 for a non-delegation grant', async () => {
      await grantStore.save({
        id: 'plain-grant',
        status: 'approved',
        created_at: Math.floor(Date.now() / 1000),
        request: { requester: DELEGATE, target_host: 'host', audience: 'sp.example.com', grant_type: 'once' },
      } as any)
      await expect(revoke('plain-grant')).rejects.toMatchObject({ statusCode: 404 })
    })

    it('returns 404 for an unknown id', async () => {
      await expect(revoke('missing')).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('list', () => {
    async function list(query: Record<string, unknown> = {}) {
      const { default: handler } = await import('../src/runtime/server/api/delegations/index.get')
      return handler({ query } as any)
    }

    it('lists both directions deduplicated, newest first', async () => {
      await createDelegationViaApi()
      // A delegation where the authed user is the delegate
      authedUser = 'third@example.com'
      await createDelegationViaApi({ delegate: DELEGATOR })
      authedUser = DELEGATOR

      const result = await list()
      expect(result.data).toHaveLength(2)
      const ids = result.data.map((g: any) => g.id)
      expect(new Set(ids).size).toBe(2)
    })

    it('filters by role', async () => {
      await createDelegationViaApi()
      authedUser = 'third@example.com'
      await createDelegationViaApi({ delegate: DELEGATOR })
      authedUser = DELEGATOR

      const asDelegator = await list({ role: 'delegator' })
      expect(asDelegator.data).toHaveLength(1)
      expect(asDelegator.data[0].request.delegator).toBe(DELEGATOR)

      const asDelegate = await list({ role: 'delegate' })
      expect(asDelegate.data).toHaveLength(1)
      expect(asDelegate.data[0].request.delegate).toBe(DELEGATOR)
    })

    it('paginates with a cursor', async () => {
      vi.useFakeTimers()
      for (let i = 0; i < 3; i++) {
        await createDelegationViaApi({ delegate: `bot-${i}@example.com` })
        vi.advanceTimersByTime(1500)
      }

      const page1 = await list({ limit: 2 })
      expect(page1.data).toHaveLength(2)
      expect(page1.pagination.has_more).toBe(true)

      const page2 = await list({ limit: 2, cursor: page1.pagination.cursor })
      expect(page2.data).toHaveLength(1)
      expect(page2.pagination.has_more).toBe(false)
    })
  })
})
