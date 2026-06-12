// story: coder-sign-in
//
// Criteria 1-5 of stories/coder-sign-in.md — the API surface of the sign-in
// boundary. Sign-in itself is delegated to @openape/nuxt-auth-sp (passkey at
// the IdP, no local account, no password); these tests pin what the app's
// own content endpoints must enforce around it.
//
// Pins the endpoint surface for the green phase:
//   handlers  server/api/projects/index.get.ts        — project overview
//             server/api/projects/index.post.ts       — create project
//             server/api/projects/[id]/index.get.ts   — project detail
//             server/api/projects/[id]/index.patch.ts — update vision/repos
//   auth      bare auto-import `requireUser(event)` → email of the signed-in
//             user (SP session cookie or human CLI bearer); throws a 401
//             problem when there is no — or an expired — session
//   data      bare auto-import `useProjectStore()` (contract pinned in
//             server/utils/projects.ts); `getForMember` returns null for
//             "does not exist" and "not a member" alike
//
// The UI flow (landing → passkey sign-in → empty overview with a create
// button) becomes a Story-Kit guide story in the green phase.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const EMAIL = 'alice@example.com'

const requireUserMock = vi.fn()
const store = {
  listForMember: vi.fn(),
  create: vi.fn(),
  getForMember: vi.fn(),
  getMembership: vi.fn(),
  addMember: vi.fn(),
  updateScope: vi.fn(),
}

function storeUntouched() {
  return Object.values(store).every(fn => fn.mock.calls.length === 0)
}

beforeEach(() => {
  requireUserMock.mockReset().mockResolvedValue(EMAIL)
  for (const fn of Object.values(store)) {
    fn.mockReset()
  }
  store.listForMember.mockResolvedValue([])
  store.getForMember.mockResolvedValue(null)
  store.getMembership.mockResolvedValue(null)
  vi.stubGlobal('requireUser', requireUserMock)
  vi.stubGlobal('useProjectStore', () => store)
  vi.stubGlobal('defineEventHandler', (fn: any) => fn)
  vi.stubGlobal('createError', (opts: any) => Object.assign(new Error(opts.statusMessage), opts))
  vi.stubGlobal('getRouterParam', (event: any, name: string) => event?.params?.[name])
  vi.stubGlobal('readBody', async (event: any) => event?.body)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const handlers = {
  listProjects: () => import('../server/api/projects/index.get'),
  createProject: () => import('../server/api/projects/index.post'),
  getProject: () => import('../server/api/projects/[id]/index.get'),
  patchProject: () => import('../server/api/projects/[id]/index.patch'),
}

async function call(load: () => Promise<{ default: unknown }>, event: Record<string, unknown> = {}) {
  const handler = (await load()).default as (event: unknown) => Promise<unknown>
  return handler(event)
}

function callForError(load: () => Promise<{ default: unknown }>, event: Record<string, unknown> = {}) {
  return call(load, event).then(() => null, (err: any) => err)
}

describe('sign-in boundary of coder.openape.ai (issue #585)', () => {
  // story: coder-sign-in — criterion 1
  it('a signed-in OpenApe identity gets her project overview — no new account, no password', async () => {
    const projects = [{ id: 'p1', name: 'Apollo', visionMd: '', repos: [] }]
    store.listForMember.mockResolvedValue(projects)

    const result = await call(handlers.listProjects)

    expect(result).toEqual(projects)
    expect(store.listForMember).toHaveBeenCalledWith(EMAIL)
    // signing in never registers anything app-side — identity comes from the IdP
    expect(store.create).not.toHaveBeenCalled()
  })

  // story: coder-sign-in — criterion 2
  it('an identity without any membership sees an empty overview — no foreign projects or people', async () => {
    const result = await call(handlers.listProjects)

    expect(result).toEqual([])
    expect(store.listForMember).toHaveBeenCalledTimes(1)
    expect(store.listForMember).toHaveBeenCalledWith(EMAIL)
  })

  // story: coder-sign-in — criterion 3
  it('an unauthenticated visitor is asked to sign in without learning whether the address exists', async () => {
    requireUserMock.mockRejectedValue(Object.assign(new Error('Authentication required'), { statusCode: 401 }))

    const existing = await callForError(handlers.getProject, { params: { id: 'p-existing' } })
    const missing = await callForError(handlers.getProject, { params: { id: 'p-missing' } })

    expect(existing?.statusCode).toBe(401)
    expect(missing?.statusCode).toBe(401)
    expect(missing?.statusMessage).toBe(existing?.statusMessage)
    expect(storeUntouched()).toBe(true)
  })

  // story: coder-sign-in — criterion 4
  it('a signed-in non-member gets the identical answer for "no access" and "does not exist"', async () => {
    // pinned store contract: getForMember(id, email) → null in both cases
    const foreign = await callForError(handlers.getProject, { params: { id: 'p-foreign' } })
    const missing = await callForError(handlers.getProject, { params: { id: 'p-never-existed' } })

    expect(foreign?.statusCode).toBe(404)
    expect(missing?.statusCode).toBe(404)
    expect(missing?.statusMessage).toBe(foreign?.statusMessage)
  })

  // story: coder-sign-in — criterion 5
  it('after sign-out or session expiry every content endpoint demands a fresh sign-in', async () => {
    requireUserMock.mockRejectedValue(Object.assign(new Error('Authentication required'), { statusCode: 401 }))

    const event = { params: { id: 'p1' }, body: { name: 'Apollo' } }
    for (const load of Object.values(handlers)) {
      const err = await callForError(load, event)
      expect(err?.statusCode).toBe(401)
    }
    expect(storeUntouched()).toBe(true)
  })
})
