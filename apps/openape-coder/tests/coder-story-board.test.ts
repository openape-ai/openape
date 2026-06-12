// story: coder-story-board
//
// All 5 criteria of stories/coder-story-board.md.
//
// Store-level criteria (1, 2, 3) run against a real in-memory SQLite
// (drizzle + libsql), the same level coder-projects.test.ts uses — the board is
// a read over the story store:
//   schema  server/database/schema.ts  (stories)
//   init    server/database/init.ts    → ensureCoderSchema(db)
//   store   server/utils/stories.ts    → createStoryStore(db)
// The member-base-right read (criterion 4) and the non-member / foreign-project
// lockout (criterion 5) are pinned at handler level with the same global-stub
// pattern as coder-sign-in.test.ts.
//
// The board UI (grouped columns, status filter) becomes a Story-Kit guide story
// in the green phase.

import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoryStatus } from '../server/utils/stories'
import { createStoryStore } from '../server/utils/stories'
import { ensureCoderSchema } from '../server/database/init'

const ALICE = 'alice@example.com'
const P1 = 'p1'

async function freshStore() {
  const db = drizzle(createClient({ url: ':memory:' }))
  await ensureCoderSchema(db)
  return createStoryStore(db)
}

async function seed(store: Awaited<ReturnType<typeof freshStore>>, projectId: string, title: string, status: StoryStatus) {
  const story = await store.create({
    projectId,
    title,
    storySentence: `Als X möchte ich ${title}, damit Y.`,
    authorEmail: ALICE,
  })
  if (status !== 'draft') {
    await store.setStatus({ id: story.id, projectId, status, actorEmail: ALICE })
  }
  return story
}

describe('story board (issue #585)', () => {
  // story: coder-story-board — criterion 1
  it('the board lists every story of the project with title and status', async () => {
    const store = await freshStore()
    await seed(store, P1, 'A', 'draft')
    await seed(store, P1, 'B', 'approved')

    const board = await store.listForProject(P1)
    expect(board).toHaveLength(2)
    for (const card of board) {
      expect(card.title).toBeTruthy()
      expect(card.status).toBeTruthy()
    }
  })

  // story: coder-story-board — criterion 2
  it('grouping by status partitions the board with no story lost', async () => {
    const store = await freshStore()
    await seed(store, P1, 'A', 'draft')
    await seed(store, P1, 'B', 'approved')
    await seed(store, P1, 'C', 'approved')

    const board = await store.listForProject(P1)
    const groups = new Map<StoryStatus, number>()
    for (const card of board) {
      groups.set(card.status, (groups.get(card.status) ?? 0) + 1)
    }
    // the groups together reconstitute the whole board (criterion 2)
    const total = [...groups.values()].reduce((a, b) => a + b, 0)
    expect(total).toBe(board.length)
    expect(groups.get('approved')).toBe(2)
    expect(groups.get('draft')).toBe(1)
  })

  // story: coder-story-board — criterion 3
  it('opening a story exposes all captured parts, readable without code or files', async () => {
    const store = await freshStore()
    const created = await store.create({
      projectId: P1,
      title: 'Detail',
      storySentence: 'Als X möchte ich Detail, damit Y.',
      acceptanceCriteria: '1. tut etwas',
      repos: ['openape-ai/openape-monorepo'],
      links: ['https://x'],
      testReferences: ['tests/x.test.ts'],
      authorEmail: ALICE,
    })

    const detail = await store.getInProject(created.id, P1)
    expect(detail?.storySentence).toContain('möchte ich')
    expect(detail?.acceptanceCriteria).toBe('1. tut etwas')
    expect(detail?.repos).toEqual(['openape-ai/openape-monorepo'])
    expect(detail?.links).toEqual(['https://x'])
    expect(detail?.testReferences).toEqual(['tests/x.test.ts'])
  })
})

describe('story board endpoints (issue #585)', () => {
  const requireUserMock = vi.fn()
  const members = { getMembership: vi.fn() }
  const stories = { listForProject: vi.fn(), getInProject: vi.fn() }

  beforeEach(() => {
    requireUserMock.mockReset().mockResolvedValue(ALICE)
    members.getMembership.mockReset().mockResolvedValue({ projectId: P1, email: ALICE, role: 'member', capabilities: [] })
    stories.listForProject.mockReset().mockResolvedValue([])
    stories.getInProject.mockReset().mockResolvedValue(null)
    vi.stubGlobal('requireUser', requireUserMock)
    vi.stubGlobal('useMembershipStore', () => members)
    vi.stubGlobal('useStoryStore', () => stories)
    vi.stubGlobal('defineEventHandler', (fn: any) => fn)
    vi.stubGlobal('createError', (opts: any) => Object.assign(new Error(opts.statusMessage), opts))
    vi.stubGlobal('getRouterParam', (event: any, name: string) => event?.params?.[name])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function call(load: () => Promise<{ default: unknown }>, event: Record<string, unknown> = {}) {
    return (async () => {
      const handler = (await load()).default as (event: unknown) => Promise<unknown>
      return handler(event)
    })()
  }
  const forError = (load: () => Promise<{ default: unknown }>, event: Record<string, unknown> = {}) =>
    call(load, event).then(() => null, (err: any) => err)

  const board = () => import('../server/api/projects/[id]/stories/index.get')

  // story: coder-story-board — criterion 4
  it('reading the board needs only base membership — no extra capability grant', async () => {
    // member with NO write capabilities may still read the board
    members.getMembership.mockResolvedValue({ projectId: P1, email: ALICE, role: 'member', capabilities: [] })
    const cards = [{ id: 's1', title: 'A', status: 'draft' }]
    stories.listForProject.mockResolvedValue(cards)

    const result = await call(board, { params: { id: P1 } })
    expect(result).toEqual(cards)
    expect(stories.listForProject).toHaveBeenCalledWith(P1)
  })

  // story: coder-story-board — criterion 5
  it('a non-member gets no board and no stories of a foreign project', async () => {
    members.getMembership.mockResolvedValue(null)

    const err = await forError(board, { params: { id: P1 } })
    expect(err?.statusCode).toBe(404)
    expect(stories.listForProject).not.toHaveBeenCalled()
  })
})
