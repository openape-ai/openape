// Helpers for the threads model. A thread is a parallel sub-conversation
// inside a 1:1 contact (= room). Each room has exactly one "main" thread
// auto-created on contact-accept; the user can spin up additional named
// threads for separate concerns (e.g. "Email-Triage", "Code-Review").

import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { messages, threads } from '../database/schema'
import type { Thread } from '../database/schema'

export const MAIN_THREAD_NAME = 'main'

export async function listThreadsInRoom(roomId: string): Promise<Thread[]> {
  const db = useDb()
  return await db
    .select()
    .from(threads)
    .where(eq(threads.roomId, roomId))
    .orderBy(asc(threads.createdAt))
    .all()
}

export async function findThreadById(id: string): Promise<Thread | null> {
  const db = useDb()
  const row = await db.select().from(threads).where(eq(threads.id, id)).get()
  return row ?? null
}

/**
 * Ensure a "main" thread exists for the room. Idempotent — returns the
 * existing one if already there. Used both by contact-accept (eager
 * creation) and by GET /api/rooms/{id}/threads (lazy backfill for legacy
 * rooms that pre-date the threads table).
 */
export async function ensureMainThread(opts: { roomId: string, createdByEmail: string }): Promise<Thread> {
  const db = useDb()
  const existing = await db
    .select()
    .from(threads)
    .where(and(eq(threads.roomId, opts.roomId), eq(threads.name, MAIN_THREAD_NAME), isNull(threads.archivedAt)))
    .get()
  if (existing) return existing
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  await db.insert(threads).values({
    id,
    roomId: opts.roomId,
    name: MAIN_THREAD_NAME,
    createdByEmail: opts.createdByEmail,
    createdAt: now,
  })
  // Also backfill: any existing room messages without a thread_id get
  // attributed to this main thread. Safe one-time op since main is the
  // only thread that could absorb them at this point.
  await db
    .update(messages)
    .set({ threadId: id })
    .where(and(eq(messages.roomId, opts.roomId), isNull(messages.threadId)))
  return (await db.select().from(threads).where(eq(threads.id, id)).get())!
}

export async function createThread(opts: {
  roomId: string
  name: string
  createdByEmail: string
}): Promise<Thread> {
  const db = useDb()
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  await db.insert(threads).values({
    id,
    roomId: opts.roomId,
    name: opts.name.trim().slice(0, 100),
    createdByEmail: opts.createdByEmail,
    createdAt: now,
  })
  return (await db.select().from(threads).where(eq(threads.id, id)).get())!
}

export async function updateThread(
  id: string,
  patch: { name?: string, archived?: boolean },
): Promise<Thread | null> {
  const db = useDb()
  const updates: Partial<Thread> = {}
  if (typeof patch.name === 'string') {
    updates.name = patch.name.trim().slice(0, 100)
  }
  if (typeof patch.archived === 'boolean') {
    updates.archivedAt = patch.archived ? Math.floor(Date.now() / 1000) : null
  }
  if (Object.keys(updates).length === 0) {
    return await findThreadById(id)
  }
  await db.update(threads).set(updates).where(eq(threads.id, id))
  return await findThreadById(id)
}
