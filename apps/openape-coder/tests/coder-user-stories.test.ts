// story: coder-user-stories
//
// All 6 criteria of stories/coder-user-stories.md.
//
// Store-level criteria (1, 2, 3, 4, 6) run against a real in-memory SQLite
// (drizzle + libsql), the same level coder-projects.test.ts uses:
//   schema  server/database/schema.ts  (stories + story_status_changes)
//   init    server/database/init.ts    → ensureCoderSchema(db)
//   store   server/utils/stories.ts    → createStoryStore(db)
// The write-permission gate (criterion 5) is pinned at handler level with the
// same global-stub pattern as coder-sign-in.test.ts.
//
// The UI flow (story editor) becomes a Story-Kit guide story in the green phase.

import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStoryStore } from '../server/utils/stories'
import { ensureCoderSchema } from '../server/database/init'

const ALICE = 'alice@example.com'
const BOB = 'bob@example.com'
const P1 = 'p1'
const P2 = 'p2'

async function freshStore() {
  const db = drizzle(createClient({ url: ':memory:' }))
  await ensureCoderSchema(db)
  return createStoryStore(db)
}

function minimal(projectId: string) {
  return {
    projectId,
    title: 'Sign in with passkey',
    storySentence: 'Als Nutzer möchte ich mich mit Passkey anmelden, damit ich kein Passwort brauche.',
    authorEmail: ALICE,
  }
}

describe('story store (issue #585)', () => {
  // story: coder-user-stories — criterion 1
  it('a story created from title + story sentence shows up in the project and is readable', async () => {
    const stories = await freshStore()
    const story = await stories.create(minimal(P1))

    expect(story.title).toBe('Sign in with passkey')
    expect(story.storySentence).toContain('Passkey')

    const listed = await stories.listForProject(P1)
    expect(listed.map(s => s.id)).toContain(story.id)
  })

  // story: coder-user-stories — criterion 2
  it('a story needs no optional fields up front — repos/links/refs/status fill in later', async () => {
    const stories = await freshStore()
    const story = await stories.create(minimal(P1))
    expect(story.repos).toEqual([])
    expect(story.links).toEqual([])
    expect(story.testReferences).toEqual([])

    await stories.update({
      id: story.id,
      projectId: P1,
      patch: { repos: ['openape-ai/openape-monorepo'], links: ['https://x'], testReferences: ['tests/x.test.ts'] },
      actorEmail: ALICE,
    })

    const got = await stories.getInProject(story.id, P1)
    expect(got?.repos).toEqual(['openape-ai/openape-monorepo'])
    expect(got?.links).toEqual(['https://x'])
    expect(got?.testReferences).toEqual(['tests/x.test.ts'])
  })

  // story: coder-user-stories — criterion 3
  it('an edit is what every member sees on the next read', async () => {
    const stories = await freshStore()
    const story = await stories.create(minimal(P1))

    await stories.update({ id: story.id, projectId: P1, patch: { title: 'Renamed' }, actorEmail: ALICE })

    const got = await stories.getInProject(story.id, P1)
    expect(got?.title).toBe('Renamed')
  })

  // story: coder-user-stories — criterion 4
  it('a status change is traceable to who changed it when', async () => {
    const stories = await freshStore()
    const story = await stories.create(minimal(P1))

    const before = Date.now()
    await stories.setStatus({ id: story.id, projectId: P1, status: 'approved', actorEmail: BOB })

    const history = await stories.statusHistory(story.id, P1)
    const last = history.at(-1)
    expect(last?.status).toBe('approved')
    expect(last?.changedBy).toBe(BOB)
    expect(last?.changedAt).toBeGreaterThanOrEqual(before)
  })

  // story: coder-user-stories — criterion 6
  it('a story is not visible outside its own project', async () => {
    const stories = await freshStore()
    const story = await stories.create(minimal(P1))

    expect(await stories.getInProject(story.id, P2)).toBeNull()
    expect((await stories.listForProject(P2)).map(s => s.id)).not.toContain(story.id)
  })
})

describe('story write endpoints (issue #585)', () => {
  const requireUserMock = vi.fn()
  const members = { hasCapability: vi.fn() }
  const stories = { create: vi.fn(), update: vi.fn(), setStatus: vi.fn() }

  beforeEach(() => {
    requireUserMock.mockReset().mockResolvedValue(BOB)
    members.hasCapability.mockReset().mockResolvedValue(false)
    for (const fn of Object.values(stories)) fn.mockReset()
    vi.stubGlobal('requireUser', requireUserMock)
    vi.stubGlobal('useMembershipStore', () => members)
    vi.stubGlobal('useStoryStore', () => stories)
    vi.stubGlobal('defineEventHandler', (fn: any) => fn)
    vi.stubGlobal('createError', (opts: any) => Object.assign(new Error(opts.statusMessage), opts))
    vi.stubGlobal('getRouterParam', (event: any, name: string) => event?.params?.[name])
    vi.stubGlobal('readBody', async (event: any) => event?.body)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function callForError(load: () => Promise<{ default: unknown }>, event: Record<string, unknown> = {}) {
    return (async () => {
      const handler = (await load()).default as (event: unknown) => Promise<unknown>
      return handler(event)
    })().then(() => null, (err: any) => err)
  }

  // story: coder-user-stories — criterion 5
  it('a member without the write grant is visibly rejected on create and edit; nothing changes', async () => {
    const createErr = await callForError(
      () => import('../server/api/projects/[id]/stories/index.post'),
      { params: { id: P1 }, body: minimal(P1) },
    )
    expect(createErr?.statusCode).toBe(403)
    expect(stories.create).not.toHaveBeenCalled()

    const editErr = await callForError(
      () => import('../server/api/projects/[id]/stories/[storyId]/index.patch'),
      { params: { id: P1, storyId: 's1' }, body: { title: 'hijacked' } },
    )
    expect(editErr?.statusCode).toBe(403)
    expect(stories.update).not.toHaveBeenCalled()
  })
})
