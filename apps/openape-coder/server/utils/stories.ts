// story: coder-user-stories, coder-story-board (#585).
//
// Story store over the stories + story_status_changes tables. A story belongs
// to exactly one project; every read is project-scoped so a story is invisible
// outside its own project. Mandatory fields are title + story sentence; all
// other fields default empty and are back-fillable.

import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { and, eq } from 'drizzle-orm'
import { stories, storyStatusChanges } from '../database/schema'
import type { StoryRow } from '../database/schema'
import { useDb } from '../database/drizzle'

export const STORY_STATUSES = ['draft', 'consistent', 'approved', 'red', 'green', 'documented'] as const
export type StoryStatus = (typeof STORY_STATUSES)[number]

export interface Story {
  id: string
  projectId: string
  /** Mandatory. */
  title: string
  /** Mandatory: "Als … möchte ich …, damit …". */
  storySentence: string
  /** Optional, back-fillable. */
  acceptanceCriteria: string
  repos: string[]
  links: string[]
  testReferences: string[]
  status: StoryStatus
  createdAt: number
  updatedAt: number
}

export interface StoryStatusChange {
  status: StoryStatus
  changedBy: string
  changedAt: number
}

export interface StoryStore {
  create: (input: {
    projectId: string
    title: string
    storySentence: string
    acceptanceCriteria?: string
    repos?: string[]
    links?: string[]
    testReferences?: string[]
    status?: StoryStatus
    authorEmail: string
  }) => Promise<Story>
  update: (input: {
    id: string
    projectId: string
    patch: Partial<Pick<Story, 'title' | 'storySentence' | 'acceptanceCriteria' | 'repos' | 'links' | 'testReferences'>>
    actorEmail: string
  }) => Promise<Story>
  setStatus: (input: { id: string, projectId: string, status: StoryStatus, actorEmail: string }) => Promise<Story>
  statusHistory: (id: string, projectId: string) => Promise<StoryStatusChange[]>
  getInProject: (id: string, projectId: string) => Promise<Story | null>
  listForProject: (projectId: string) => Promise<Story[]>
}

type Db = LibSQLDatabase<Record<string, never>>

function rowToStory(row: StoryRow): Story {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    storySentence: row.storySentence,
    acceptanceCriteria: row.acceptanceCriteria,
    repos: JSON.parse(row.repos) as string[],
    links: JSON.parse(row.links) as string[],
    testReferences: JSON.parse(row.testReferences) as string[],
    status: row.status as StoryStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function createStoryStore(db: Db): StoryStore {
  async function getRow(id: string, projectId: string): Promise<StoryRow | null> {
    const rows = await db
      .select()
      .from(stories)
      .where(and(eq(stories.id, id), eq(stories.projectId, projectId)))
      .limit(1)
    return rows[0] ?? null
  }

  async function require(id: string, projectId: string): Promise<Story> {
    const row = await getRow(id, projectId)
    if (!row) throw createError({ statusCode: 404, statusMessage: 'story not found' })
    return rowToStory(row)
  }

  return {
    async create(input) {
      const now = Date.now()
      const id = crypto.randomUUID()
      const status = input.status ?? 'draft'
      await db.insert(stories).values({
        id,
        projectId: input.projectId,
        title: input.title,
        storySentence: input.storySentence,
        acceptanceCriteria: input.acceptanceCriteria ?? '',
        repos: JSON.stringify(input.repos ?? []),
        links: JSON.stringify(input.links ?? []),
        testReferences: JSON.stringify(input.testReferences ?? []),
        status,
        createdAt: now,
        updatedAt: now,
      })
      return require(id, input.projectId)
    },

    async update({ id, projectId, patch }) {
      await require(id, projectId)
      const set: Partial<StoryRow> = { updatedAt: Date.now() }
      if (patch.title !== undefined) set.title = patch.title
      if (patch.storySentence !== undefined) set.storySentence = patch.storySentence
      if (patch.acceptanceCriteria !== undefined) set.acceptanceCriteria = patch.acceptanceCriteria
      if (patch.repos !== undefined) set.repos = JSON.stringify(patch.repos)
      if (patch.links !== undefined) set.links = JSON.stringify(patch.links)
      if (patch.testReferences !== undefined) set.testReferences = JSON.stringify(patch.testReferences)
      await db
        .update(stories)
        .set(set)
        .where(and(eq(stories.id, id), eq(stories.projectId, projectId)))
      return require(id, projectId)
    },

    async setStatus({ id, projectId, status, actorEmail }) {
      await require(id, projectId)
      const changedAt = Date.now()
      await db
        .update(stories)
        .set({ status, updatedAt: changedAt })
        .where(and(eq(stories.id, id), eq(stories.projectId, projectId)))
      await db.insert(storyStatusChanges).values({
        id: crypto.randomUUID(),
        storyId: id,
        projectId,
        status,
        changedBy: actorEmail,
        changedAt,
      })
      return require(id, projectId)
    },

    async statusHistory(id, projectId) {
      const rows = await db
        .select()
        .from(storyStatusChanges)
        .where(and(eq(storyStatusChanges.storyId, id), eq(storyStatusChanges.projectId, projectId)))
        .orderBy(storyStatusChanges.changedAt)
      return rows.map(r => ({
        status: r.status as StoryStatus,
        changedBy: r.changedBy,
        changedAt: r.changedAt,
      }))
    },

    async getInProject(id, projectId) {
      const row = await getRow(id, projectId)
      return row ? rowToStory(row) : null
    },

    async listForProject(projectId) {
      const rows = await db.select().from(stories).where(eq(stories.projectId, projectId))
      return rows.map(rowToStory)
    },
  }
}

export function useStoryStore(): StoryStore {
  return createStoryStore(useDb() as unknown as Db)
}
