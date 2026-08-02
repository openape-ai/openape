// Security checklist: admin registration URLs. A registration token is a
// bearer-grade invite — whoever holds it enrols a passkey for the named
// address — so these tests pin what is persisted (audit trail, expiry),
// which caller identity is recorded, and that revocation really removes
// the row.

import { createStorage } from 'unstorage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminEvent } from './helpers/admin-event'

const ADMIN = 'admin@example.com'
const MGMT_TOKEN = 'management-secret'
const ORIGIN = 'https://id.openape.test'
const INVITEE = 'newcomer@example.com'
const HOUR_MS = 60 * 60 * 1000

const storages = new Map<string, ReturnType<typeof createStorage>>()

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({
    openapeIdp: {
      storageKey: 'idp',
      issuer: ORIGIN,
      rpID: 'id.openape.test',
      rpOrigin: ORIGIN,
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

async function registrationUrlStore() {
  const { createRegistrationUrlStore } = await import('../src/runtime/server/utils/registration-url-store')
  return createRegistrationUrlStore()
}

async function createRegistrationUrl(body: unknown, event?: any) {
  const { default: handler } = await import('../src/runtime/server/api/admin/registration-urls/index.post')
  return handler(event ?? asAdmin({ body }))
}

async function listRegistrationUrls() {
  const { default: handler } = await import('../src/runtime/server/api/admin/registration-urls/index.get')
  return handler(asAdmin())
}

async function deleteRegistrationUrl(token: string, event?: any) {
  const { default: handler } = await import('../src/runtime/server/api/admin/registration-urls/[token].delete')
  return handler(event ?? asAdmin({ params: { token } }))
}

describe('admin registration URLs', () => {
  beforeEach(async () => {
    for (const storage of storages.values()) await storage.clear()
    sessionUserId = ADMIN
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('auth gate', () => {
    const routes: Array<[string, string, Record<string, string>]> = [
      ['GET /registration-urls', '../src/runtime/server/api/admin/registration-urls/index.get', {}],
      ['POST /registration-urls', '../src/runtime/server/api/admin/registration-urls/index.post', {}],
      ['DELETE /registration-urls/:token', '../src/runtime/server/api/admin/registration-urls/[token].delete', { token: 'tok' }],
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

    it('mints no invite when the caller is rejected', async () => {
      sessionUserId = 'mortal@example.com'
      const { default: handler } = await import('../src/runtime/server/api/admin/registration-urls/index.post')
      await expect(handler(adminEvent({ body: { email: INVITEE, name: 'New' } })))
        .rejects
        .toMatchObject({ statusCode: 403 })
      expect(await (await registrationUrlStore()).list()).toEqual([])
    })
  })

  describe('POST /registration-urls', () => {
    it('mints a usable invite and records who issued it', async () => {
      const result = await createRegistrationUrl({ email: INVITEE, name: 'Newcomer' })

      expect(result.ok).toBe(true)
      expect(result.registrationUrl).toBe(`${ORIGIN}/register?token=${result.token}`)
      expect(result.expiresInHours).toBe(24)

      const stored = await (await registrationUrlStore()).find(result.token)
      expect(stored).toMatchObject({
        token: result.token,
        email: INVITEE,
        name: 'Newcomer',
        createdBy: ADMIN,
        consumed: false,
      })
    })

    it('records the management identity when called with the management token', async () => {
      sessionUserId = undefined
      const result = await createRegistrationUrl(
        { email: INVITEE, name: 'Newcomer' },
        adminEvent({ auth: `Bearer ${MGMT_TOKEN}`, body: { email: INVITEE, name: 'Newcomer' } }),
      )
      const stored = await (await registrationUrlStore()).find(result.token)
      expect(stored!.createdBy).toBe('_management_')
    })

    it('defaults the invite to a 24 hour lifetime', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

      const result = await createRegistrationUrl({ email: INVITEE, name: 'Newcomer' })
      const stored = await (await registrationUrlStore()).find(result.token)
      expect(stored!.expiresAt - stored!.createdAt).toBe(24 * HOUR_MS)
    })

    it('honours a custom expiresInHours', async () => {
      const result = await createRegistrationUrl({ email: INVITEE, name: 'Newcomer', expiresInHours: 2 })
      expect(result.expiresInHours).toBe(2)

      const stored = await (await registrationUrlStore()).find(result.token)
      expect(stored!.expiresAt - stored!.createdAt).toBe(2 * HOUR_MS)
    })

    it('issues distinct tokens for repeated invites to the same address', async () => {
      const first = await createRegistrationUrl({ email: INVITEE, name: 'Newcomer' })
      const second = await createRegistrationUrl({ email: INVITEE, name: 'Newcomer' })
      expect(first.token).not.toBe(second.token)
      expect(await (await registrationUrlStore()).list()).toHaveLength(2)
    })

    it.each([
      ['email', { name: 'Newcomer' }],
      ['name', { email: INVITEE }],
      ['both', {}],
    ])('rejects a body missing %s with 400 and stores nothing', async (_label, body) => {
      await expect(createRegistrationUrl(body)).rejects.toMatchObject({ statusCode: 400 })
      expect(await (await registrationUrlStore()).list()).toEqual([])
    })
  })

  describe('GET /registration-urls', () => {
    it('lists the outstanding invites', async () => {
      const first = await createRegistrationUrl({ email: INVITEE, name: 'Newcomer' })
      const second = await createRegistrationUrl({ email: 'other@example.com', name: 'Other' })

      const listed = await listRegistrationUrls()
      expect(listed.map((r: any) => r.token).sort()).toEqual([first.token, second.token].sort())
    })

    it('returns an empty list when nothing is outstanding', async () => {
      expect(await listRegistrationUrls()).toEqual([])
    })

    it('keeps consumed and expired invites visible for the audit trail', async () => {
      const consumed = await createRegistrationUrl({ email: INVITEE, name: 'Newcomer' })
      await (await registrationUrlStore()).consume(consumed.token)

      const expired = await createRegistrationUrl({ email: 'stale@example.com', name: 'Stale' })
      const store = await registrationUrlStore()
      const row = (await store.list()).find(r => r.token === expired.token)!
      await store.save({ ...row, expiresAt: Date.now() - 1000 })

      const listed = await listRegistrationUrls()
      expect(listed.map((r: any) => r.token).sort()).toEqual([consumed.token, expired.token].sort())
      // ... while `find` — the redemption path — refuses both.
      expect(await store.find(consumed.token)).toBeNull()
      expect(await store.find(expired.token)).toBeNull()
    })
  })

  describe('DELETE /registration-urls/:token', () => {
    it('removes the invite so it can no longer be redeemed', async () => {
      const created = await createRegistrationUrl({ email: INVITEE, name: 'Newcomer' })

      expect(await deleteRegistrationUrl(created.token)).toEqual({ ok: true })
      expect(await (await registrationUrlStore()).find(created.token)).toBeNull()
      expect(await listRegistrationUrls()).toEqual([])
    })

    it('leaves the other invites alone', async () => {
      const doomed = await createRegistrationUrl({ email: INVITEE, name: 'Newcomer' })
      const keeper = await createRegistrationUrl({ email: 'other@example.com', name: 'Other' })

      await deleteRegistrationUrl(doomed.token)
      expect((await listRegistrationUrls()).map((r: any) => r.token)).toEqual([keeper.token])
    })

    it('reports success for an unknown token — revocation is idempotent', async () => {
      expect(await deleteRegistrationUrl('never-existed')).toEqual({ ok: true })
    })

    it('rejects a missing token with 400', async () => {
      await expect(deleteRegistrationUrl('', asAdmin({ params: {} })))
        .rejects
        .toMatchObject({ statusCode: 400 })
    })
  })
})
