// Security checklist: the admin session surface — listing live refresh
// families and revoking them, per family or per user. Revocation is the
// operators only lever against an already-issued refresh chain, so each
// route is checked against what the store reports afterwards, not against
// its return value alone.

import { createStorage } from 'unstorage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adminEvent } from './helpers/admin-event'

const ADMIN = 'admin@example.com'
const MGMT_TOKEN = 'management-secret'
const USER = 'human@example.com'
const OTHER = 'other@example.com'
const CLIENT = 'cli.openape.test'

const storages = new Map<string, ReturnType<typeof createStorage>>()

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({
    openapeIdp: {
      storageKey: 'idp',
      issuer: 'https://id.openape.test',
      adminEmails: ADMIN,
      managementToken: MGMT_TOKEN,
    },
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

async function refreshTokenStore() {
  const { createRefreshTokenStore } = await import('../src/runtime/server/utils/refresh-token-store')
  return createRefreshTokenStore()
}

async function openSession(userId: string, ttlMs?: number) {
  return (await refreshTokenStore()).create(userId, CLIENT, ttlMs)
}

async function listSessions(query: Record<string, unknown> = {}) {
  const { default: handler } = await import('../src/runtime/server/api/admin/sessions/index.get')
  return handler(asAdmin({ query }))
}

async function revokeFamily(familyId: string, event?: any) {
  const { default: handler } = await import('../src/runtime/server/api/admin/sessions/[familyId].delete')
  return handler(event ?? asAdmin({ params: { familyId } }))
}

async function revokeUser(email: string, event?: any) {
  const { default: handler } = await import('../src/runtime/server/api/admin/sessions/user/[email].delete')
  return handler(event ?? asAdmin({ params: { email } }))
}

async function liveFamilyIds(userId?: string) {
  const result = await (await refreshTokenStore()).listFamilies(userId ? { userId } : {})
  return result.data.map(f => f.familyId)
}

describe('admin sessions', () => {
  beforeEach(async () => {
    for (const storage of storages.values()) await storage.clear()
    sessionUserId = ADMIN
  })

  describe('auth gate', () => {
    const routes: Array<[string, string, Record<string, string>]> = [
      ['GET /sessions', '../src/runtime/server/api/admin/sessions/index.get', {}],
      ['DELETE /sessions/:familyId', '../src/runtime/server/api/admin/sessions/[familyId].delete', { familyId: 'fam-1' }],
      ['DELETE /sessions/user/:email', '../src/runtime/server/api/admin/sessions/user/[email].delete', { email: USER }],
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

    it('leaves a session alive when the revoking caller is rejected', async () => {
      const { familyId } = await openSession(USER)
      sessionUserId = 'mortal@example.com'

      const { default: handler } = await import('../src/runtime/server/api/admin/sessions/[familyId].delete')
      await expect(handler(adminEvent({ params: { familyId } }))).rejects.toMatchObject({ statusCode: 403 })
      expect(await liveFamilyIds()).toContain(familyId)
    })
  })

  describe('GET /sessions', () => {
    it('lists every live family with its owner and client', async () => {
      const { familyId } = await openSession(USER)
      const result = await listSessions()

      expect(result.data).toHaveLength(1)
      expect(result.data[0]).toMatchObject({ familyId, userId: USER, clientId: CLIENT, revoked: false })
      expect(result.pagination.has_more).toBe(false)
    })

    it('filters by the user query parameter', async () => {
      const mine = await openSession(USER)
      await openSession(OTHER)

      const result = await listSessions({ user: USER })
      expect(result.data.map((f: any) => f.familyId)).toEqual([mine.familyId])
    })

    it('treats an empty user parameter as no filter', async () => {
      await openSession(USER)
      await openSession(OTHER)
      expect((await listSessions({ user: '' })).data).toHaveLength(2)
    })

    it('honours limit and reports has_more', async () => {
      await openSession(USER)
      await openSession(USER)
      await openSession(USER)

      const page = await listSessions({ limit: '2' })
      expect(page.data).toHaveLength(2)
      expect(page.pagination.has_more).toBe(true)
    })

    it('walks the remaining families via the cursor', async () => {
      await openSession(USER)
      await openSession(USER)
      await openSession(USER)

      const first = await listSessions({ limit: '2' })
      const second = await listSessions({ limit: '2', cursor: first.pagination.cursor })

      expect(second.data).toHaveLength(1)
      expect(second.pagination.has_more).toBe(false)
      const seen = [...first.data, ...second.data].map((f: any) => f.familyId)
      expect(new Set(seen).size).toBe(3)
    })

    it('hides revoked families', async () => {
      const { familyId } = await openSession(USER)
      await (await refreshTokenStore()).revokeFamily(familyId)
      expect((await listSessions()).data).toEqual([])
    })

    it('hides expired families', async () => {
      await openSession(USER, -1000)
      expect((await listSessions()).data).toEqual([])
    })

    it('returns an empty page when nothing is open', async () => {
      const result = await listSessions()
      expect(result.data).toEqual([])
      expect(result.pagination.cursor).toBeNull()
    })
  })

  describe('DELETE /sessions/:familyId', () => {
    it('revokes exactly that family', async () => {
      const target = await openSession(USER)
      const bystander = await openSession(USER)

      expect(await revokeFamily(target.familyId)).toEqual({ status: 'revoked', familyId: target.familyId })
      expect(await liveFamilyIds()).toEqual([bystander.familyId])
    })

    it('kills the refresh token belonging to that family', async () => {
      const { token, familyId } = await openSession(USER)
      await revokeFamily(familyId)

      await expect((await refreshTokenStore()).consume(token))
        .rejects
        .toThrow('Token family revoked')
    })

    it('reports success for an unknown family — revocation is idempotent', async () => {
      expect(await revokeFamily('never-existed')).toEqual({ status: 'revoked', familyId: 'never-existed' })
    })

    it('rejects a missing familyId with 400', async () => {
      await expect(revokeFamily('', asAdmin({ params: {} }))).rejects.toMatchObject({ statusCode: 400 })
    })
  })

  describe('DELETE /sessions/user/:email', () => {
    it('revokes every family of that user and spares the others', async () => {
      await openSession(USER)
      await openSession(USER)
      const bystander = await openSession(OTHER)

      expect(await revokeUser(USER)).toEqual({ status: 'revoked', email: USER })
      expect(await liveFamilyIds(USER)).toEqual([])
      expect(await liveFamilyIds()).toEqual([bystander.familyId])
    })

    it('decodes a URL-encoded email', async () => {
      await openSession(USER)
      expect(await revokeUser(encodeURIComponent(USER))).toEqual({ status: 'revoked', email: USER })
      expect(await liveFamilyIds(USER)).toEqual([])
    })

    it('reports success for a user without sessions', async () => {
      expect(await revokeUser('ghost@example.com')).toEqual({ status: 'revoked', email: 'ghost@example.com' })
    })

    it('rejects a missing email with 400', async () => {
      await expect(revokeUser('', asAdmin({ params: {} }))).rejects.toMatchObject({ statusCode: 400 })
    })
  })

  // FINDING C: neither deactivating nor deleting an identity touches its
  // refresh families. For deactivation that is by design — since #1146 the
  // refresh and /authorize paths re-check `isActive` at use time. Deletion
  // has no such backstop: those same checks pass an identity they cannot
  // find, so the family below stays usable. See PR body.
  describe('lifecycle interaction with the identity routes', () => {
    async function seedUser(email: string) {
      const { createUserStore } = await import('../src/runtime/server/utils/user-store')
      await createUserStore().create({ email, name: 'Human', isActive: true, createdAt: 1 } as any)
    }

    it('keeps the session listed after the identity is deactivated', async () => {
      await seedUser(USER)
      const { familyId } = await openSession(USER)

      const { default: put } = await import('../src/runtime/server/api/admin/agents/[id].put')
      await put(asAdmin({ params: { id: USER }, body: { isActive: false } }))

      expect((await listSessions({ user: USER })).data.map((f: any) => f.familyId)).toEqual([familyId])
    })

    it('keeps the session listed after the identity is deleted', async () => {
      await seedUser(USER)
      const { familyId } = await openSession(USER)

      const { default: del } = await import('../src/runtime/server/api/admin/users/[email].delete')
      await del(asAdmin({ params: { email: USER } }))

      expect((await listSessions({ user: USER })).data.map((f: any) => f.familyId)).toEqual([familyId])
    })
  })
})
