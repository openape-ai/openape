// Security checklist: the admin delegation surface. Delegations are the
// grants that let one identity act for another, so the operator view must
// not blur into the rest of the grant store: the list is type-filtered and
// the revoke route refuses to touch a non-delegation grant it was handed
// by id.

import { createStorage } from 'unstorage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adminEvent } from './helpers/admin-event'

const ADMIN = 'admin@example.com'
const MGMT_TOKEN = 'management-secret'
const DELEGATOR = 'owner@example.com'
const DELEGATE = 'bot@example.com'
const AUDIENCE = 'sp.openape.test'

const storages = new Map<string, ReturnType<typeof createStorage>>()

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({
    openapeIdp: {
      storageKey: 'idp',
      issuer: 'https://id.openape.test',
      adminEmails: ADMIN,
      managementToken: MGMT_TOKEN,
    },
    openapeGrants: { storageKey: 'grants' },
  }),
  useEvent: () => undefined,
  useStorage: (key: string) => {
    if (!storages.has(key)) storages.set(key, createStorage())
    return storages.get(key)!
  },
}))

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  readBody: async (event: any) => event.body,
  getQuery: (event: any) => event.query ?? {},
  getRouterParam: (event: any, name: string) => event.params?.[name],
  getHeader: (event: any, name: string) => event.headers?.[name.toLowerCase()],
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), opts),
}))

let sessionUserId: string | undefined
vi.mock('../src/runtime/server/utils/session', () => ({
  getAppSession: async () => ({ data: { userId: sessionUserId } }),
}))

function asAdmin(options: Parameters<typeof adminEvent>[0] = {}) {
  sessionUserId = ADMIN
  return adminEvent(options)
}

async function grantStore() {
  const { createGrantStore } = await import('../src/runtime/server/utils/grant-store')
  return createGrantStore()
}

async function seedDelegation(overrides: Record<string, unknown> = {}) {
  const { createDelegation } = await import('@openape/grants')
  return createDelegation({
    delegator: DELEGATOR,
    delegate: DELEGATE,
    audience: AUDIENCE,
    grant_type: 'always',
    ...overrides,
  } as any, await grantStore())
}

async function seedPlainGrant() {
  const { createGrant } = await import('@openape/grants')
  return createGrant({
    requester: DELEGATE,
    target_host: AUDIENCE,
    audience: AUDIENCE,
    grant_type: 'once',
    permissions: ['tasks.read'],
  }, await grantStore())
}

async function listDelegations() {
  const { default: handler } = await import('../src/runtime/server/api/admin/delegations/index.get')
  return handler(asAdmin())
}

async function revokeDelegation(id: string, event?: any) {
  const { default: handler } = await import('../src/runtime/server/api/admin/delegations/[id].delete')
  return handler(event ?? asAdmin({ params: { id } }))
}

describe('admin delegations', () => {
  beforeEach(async () => {
    for (const storage of storages.values()) await storage.clear()
    sessionUserId = ADMIN
  })

  describe('auth gate', () => {
    const routes: Array<[string, string, Record<string, string>]> = [
      ['GET /delegations', '../src/runtime/server/api/admin/delegations/index.get', {}],
      ['DELETE /delegations/:id', '../src/runtime/server/api/admin/delegations/[id].delete', { id: 'grant-1' }],
    ]

    it.each(routes)('%s rejects an anonymous caller with 401', async (_name, path, params) => {
      sessionUserId = undefined
      const { default: handler } = await import(path)
      await expect(handler(adminEvent({ params }))).rejects.toMatchObject({ statusCode: 401 })
    })

    it.each(routes)('%s rejects a non-admin session with 403', async (_name, path, params) => {
      sessionUserId = 'mortal@example.com'
      const { default: handler } = await import(path)
      await expect(handler(adminEvent({ params }))).rejects.toMatchObject({ statusCode: 403 })
    })

    it.each(routes)('%s rejects a wrong management token with 403', async (_name, path, params) => {
      sessionUserId = ADMIN
      const { default: handler } = await import(path)
      await expect(handler(adminEvent({ auth: 'Bearer nope', params })))
        .rejects
        .toMatchObject({ statusCode: 403 })
    })

    it('leaves the delegation approved when the revoking caller is rejected', async () => {
      const grant = await seedDelegation()
      sessionUserId = 'mortal@example.com'

      const { default: handler } = await import('../src/runtime/server/api/admin/delegations/[id].delete')
      await expect(handler(adminEvent({ params: { id: grant.id } }))).rejects.toMatchObject({ statusCode: 403 })
      expect((await (await grantStore()).findById(grant.id))!.status).toBe('approved')
    })

    it('accepts the management token without a session', async () => {
      sessionUserId = undefined
      const grant = await seedDelegation()

      const { default: handler } = await import('../src/runtime/server/api/admin/delegations/index.get')
      const listed = await handler(adminEvent({ auth: `Bearer ${MGMT_TOKEN}` }))
      expect(listed.map((g: any) => g.id)).toEqual([grant.id])
    })
  })

  describe('GET /delegations', () => {
    it('returns the delegations with their delegator and delegate', async () => {
      const grant = await seedDelegation({ scopes: ['tasks.read'] })

      const listed = await listDelegations()
      expect(listed).toHaveLength(1)
      expect(listed[0]).toMatchObject({ id: grant.id, type: 'delegation', status: 'approved' })
      expect(listed[0].request).toMatchObject({
        delegator: DELEGATOR,
        delegate: DELEGATE,
        audience: AUDIENCE,
        scopes: ['tasks.read'],
      })
    })

    it('excludes grants that are not delegations', async () => {
      const delegation = await seedDelegation()
      await seedPlainGrant()

      expect((await listDelegations()).map((g: any) => g.id)).toEqual([delegation.id])
    })

    it('keeps revoked delegations visible for the audit trail', async () => {
      const grant = await seedDelegation()
      await revokeDelegation(grant.id)

      const listed = await listDelegations()
      expect(listed.map((g: any) => g.status)).toEqual(['revoked'])
    })

    it('returns an empty list when no delegations exist', async () => {
      expect(await listDelegations()).toEqual([])
    })
  })

  describe('DELETE /delegations/:id', () => {
    it('revokes the delegation and returns the updated grant', async () => {
      const grant = await seedDelegation()

      const revoked = await revokeDelegation(grant.id)
      expect(revoked).toMatchObject({ id: grant.id, status: 'revoked' })
      expect((await (await grantStore()).findById(grant.id))!.status).toBe('revoked')
    })

    it('revokes only the addressed delegation', async () => {
      const doomed = await seedDelegation()
      const keeper = await seedDelegation({ delegate: 'other@example.com' })

      await revokeDelegation(doomed.id)
      expect((await (await grantStore()).findById(keeper.id))!.status).toBe('approved')
    })

    it('returns 404 for an unknown id', async () => {
      await expect(revokeDelegation('does-not-exist')).rejects.toMatchObject({ statusCode: 404 })
    })

    it('refuses to revoke a grant that is not a delegation', async () => {
      const plain = await seedPlainGrant()

      await expect(revokeDelegation(plain.id)).rejects.toMatchObject({ statusCode: 404 })
      expect((await (await grantStore()).findById(plain.id))!.status).toBe('pending')
    })

    it('rejects a missing id with 400', async () => {
      await expect(revokeDelegation('', asAdmin({ params: {} }))).rejects.toMatchObject({ statusCode: 400 })
    })

    // FINDING D: revoking twice escapes as a bare Error from @openape/grants
    // instead of a problem+json 4xx, so the client sees a 500 for a
    // no-op. Pinned rather than fixed — see PR body.
    it('surfaces a bare error instead of a 4xx when revoked twice', async () => {
      const grant = await seedDelegation()
      await revokeDelegation(grant.id)

      const second = revokeDelegation(grant.id).catch(err => err)
      await expect(second).resolves.toBeInstanceOf(Error)
      await expect(second).resolves.not.toHaveProperty('statusCode')
    })
  })
})
