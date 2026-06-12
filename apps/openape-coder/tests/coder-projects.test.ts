// story: coder-projects
//
// Criteria 1-5 of stories/coder-projects.md.
//
// Criteria 1-4 pin the project store against a real in-memory SQLite
// (drizzle + libsql), the same level the chat schema test uses:
//   schema  server/database/schema.ts  (projects + project_members)
//   init    server/database/init.ts    → ensureCoderSchema(db)
//   store   server/utils/projects.ts   → createProjectStore(db)
// Criterion 5 — plus the endpoint wiring of criteria 1 and 3 — is pinned at
// handler level with the same global-stub pattern as coder-sign-in.test.ts.
//
// The UI flow (create dialog, vision/repos editing) becomes a Story-Kit
// guide story in the green phase.

import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureCoderSchema } from '../server/database/init'
import { createProjectStore } from '../server/utils/projects'

const ALICE = 'alice@example.com'
const BOB = 'bob@example.com'
const CAROL = 'carol@example.com'

async function freshStore() {
  const db = drizzle(createClient({ url: ':memory:' }))
  await ensureCoderSchema(db)
  return createProjectStore(db)
}

describe('project store (issue #585)', () => {
  // story: coder-projects — criterion 1
  it('creating a project puts it into the creator\'s overview and makes the creator its admin', async () => {
    const store = await freshStore()
    const project = await store.create({ name: 'Apollo', creatorEmail: ALICE })

    const overview = await store.listForMember(ALICE)
    expect(overview.map(p => p.id)).toContain(project.id)

    const membership = await store.getMembership(project.id, ALICE)
    expect(membership?.role).toBe('admin')
    expect(membership?.canEditScope).toBe(true)
  })

  // story: coder-projects — criterion 2
  it('a project needs neither vision nor repos to be created — both can be added later', async () => {
    const store = await freshStore()
    const project = await store.create({ name: 'Apollo', creatorEmail: ALICE })
    expect(project.visionMd).toBe('')
    expect(project.repos).toEqual([])

    await store.updateScope(project.id, { visionMd: 'Ship the canon.' })
    await store.updateScope(project.id, { repos: ['openape-ai/openape-monorepo'] })

    const got = await store.getForMember(project.id, ALICE)
    expect(got?.visionMd).toBe('Ship the canon.')
    expect(got?.repos).toEqual(['openape-ai/openape-monorepo'])
  })

  // story: coder-projects — criterion 3
  it('an admin\'s change of vision or repos is what members see on their next read', async () => {
    const store = await freshStore()
    const project = await store.create({ name: 'Apollo', creatorEmail: ALICE, visionMd: 'v1' })
    await store.addMember(project.id, BOB, { role: 'member' })

    await store.updateScope(project.id, { visionMd: 'v2', repos: ['openape-ai/protocol'] })

    const seenByMember = await store.getForMember(project.id, BOB)
    expect(seenByMember?.visionMd).toBe('v2')
    expect(seenByMember?.repos).toEqual(['openape-ai/protocol'])
  })

  // story: coder-projects — criterion 4
  it('the overview lists exactly the projects with own membership — admin or member, nothing else', async () => {
    const store = await freshStore()
    const mine = await store.create({ name: 'Mine', creatorEmail: ALICE })
    const other = await store.create({ name: 'Other', creatorEmail: BOB })
    const shared = await store.create({ name: 'Shared', creatorEmail: CAROL })
    await store.addMember(shared.id, ALICE, { role: 'member' })

    const aliceSees = (await store.listForMember(ALICE)).map(p => p.id).sort()
    expect(aliceSees).toEqual([mine.id, shared.id].sort())

    const bobSees = (await store.listForMember(BOB)).map(p => p.id)
    expect(bobSees).toEqual([other.id])
  })
})

describe('project endpoints (issue #585)', () => {
  const requireUserMock = vi.fn()
  const store = {
    listForMember: vi.fn(),
    create: vi.fn(),
    getForMember: vi.fn(),
    getMembership: vi.fn(),
    addMember: vi.fn(),
    updateScope: vi.fn(),
  }

  beforeEach(() => {
    requireUserMock.mockReset().mockResolvedValue(ALICE)
    for (const fn of Object.values(store)) {
      fn.mockReset()
    }
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

  async function call(load: () => Promise<{ default: unknown }>, event: Record<string, unknown> = {}) {
    const handler = (await load()).default as (event: unknown) => Promise<unknown>
    return handler(event)
  }

  // story: coder-projects — criterion 1
  it('POST /api/projects creates the project in the name of the signed-in user', async () => {
    const created = { id: 'p1', name: 'Apollo', visionMd: '', repos: [] }
    store.create.mockResolvedValue(created)

    const result = await call(() => import('../server/api/projects/index.post'), { body: { name: 'Apollo' } })

    expect(result).toEqual(created)
    expect(store.create).toHaveBeenCalledTimes(1)
    expect(store.create.mock.calls[0]![0]).toMatchObject({ name: 'Apollo', creatorEmail: ALICE })
  })

  // story: coder-projects — criterion 3
  it('PATCH /api/projects/:id lets a permitted admin update vision and repos', async () => {
    store.getMembership.mockResolvedValue({ role: 'admin', canEditScope: true })
    const repos = ['https://github.com/openape-ai/protocol']
    const updated = { id: 'p1', name: 'Apollo', visionMd: 'v2', repos }
    store.updateScope.mockResolvedValue(updated)

    const result = await call(() => import('../server/api/projects/[id]/index.patch'), {
      params: { id: 'p1' },
      body: { visionMd: 'v2', repos },
    })

    expect(result).toEqual(updated)
    expect(store.updateScope).toHaveBeenCalledWith('p1', { visionMd: 'v2', repos })
  })

  // story: coder-projects — criterion 5
  it('a member without the scope permission is visibly rejected and nothing changes', async () => {
    requireUserMock.mockResolvedValue(BOB)
    store.getMembership.mockResolvedValue({ role: 'member', canEditScope: false })

    const err = await call(() => import('../server/api/projects/[id]/index.patch'), {
      params: { id: 'p1' },
      body: { visionMd: 'hijacked' },
    }).then(() => null, (e: any) => e)

    expect(err?.statusCode).toBe(403)
    expect(err?.statusMessage).toBeTruthy()
    expect(store.updateScope).not.toHaveBeenCalled()
  })

  // story: coder-projects — criterion 6 (repos are forge URLs, not owner/repo)
  it('rejects a repo entry that is not an http(s) URL and changes nothing', async () => {
    store.getMembership.mockResolvedValue({ role: 'admin', canEditScope: true })

    const err = await call(() => import('../server/api/projects/[id]/index.patch'), {
      params: { id: 'p1' },
      body: { repos: ['openape-ai/openape-monorepo'] },
    }).then(() => null, (e: any) => e)

    expect(err?.statusCode).toBe(400)
    expect(store.updateScope).not.toHaveBeenCalled()
  })

  // story: coder-projects — criterion 6
  it('accepts full forge URLs across providers (github, gitlab, forgejo, self-hosted)', async () => {
    store.getMembership.mockResolvedValue({ role: 'admin', canEditScope: true })
    const repos = [
      'https://github.com/openape-ai/openape-monorepo',
      'https://gitlab.com/group/project',
      'https://git.openape.ai/openape/coder',
    ]
    store.updateScope.mockResolvedValue({ id: 'p1', name: 'Apollo', visionMd: '', repos })

    await call(() => import('../server/api/projects/[id]/index.patch'), {
      params: { id: 'p1' },
      body: { repos },
    })

    expect(store.updateScope).toHaveBeenCalledWith('p1', { repos })
  })
})
