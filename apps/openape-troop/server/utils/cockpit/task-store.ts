import { eq, lt, sql } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { cockpitTasks } from '../../database/schema'

// Durability layer for the in-memory queue: persist an in-flight task's input,
// forget it on terminal resolve, reload the unfinished ones on boot. Best-effort
// (callers fire-and-forget) — an occasional orphan self-heals in one cycle.

export interface StoredTask { id: string, company: string, owner: string, systemPrompt: string, userMessage: string, createdAt: number, notBefore?: number, lastNote?: string, question?: string, options?: string[], askedAt?: number, files?: { id: string, mime: string, name: string }[] }

// An open question waits for a human, so it outlives the normal in-flight
// window by far (mirrors ASK_TTL_MS in queue.ts).
const ASK_MAX_AGE_MS = 7 * 24 * 60 * 60_000

// This module owns the cockpit_tasks DDL. The boot rehydrate runs before the
// server accepts requests, so ensuring the table here (idempotent) removes the
// startup race with the DB-init plugin — Nitro plugins are not strictly ordered.
export async function ensureTaskTable(): Promise<void> {
  await useDb().run(sql`CREATE TABLE IF NOT EXISTS cockpit_tasks (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    org_id TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    user_message TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    not_before INTEGER,
    last_note TEXT,
    question TEXT,
    options TEXT,
    asked_at INTEGER,
    files TEXT
  )`)
  await useDb().run(sql`ALTER TABLE cockpit_tasks ADD COLUMN not_before INTEGER`).catch(() => {})
  await useDb().run(sql`ALTER TABLE cockpit_tasks ADD COLUMN last_note TEXT`).catch(() => {})
  await useDb().run(sql`ALTER TABLE cockpit_tasks ADD COLUMN question TEXT`).catch(() => {})
  await useDb().run(sql`ALTER TABLE cockpit_tasks ADD COLUMN options TEXT`).catch(() => {})
  await useDb().run(sql`ALTER TABLE cockpit_tasks ADD COLUMN asked_at INTEGER`).catch(() => {})
  await useDb().run(sql`ALTER TABLE cockpit_tasks ADD COLUMN files TEXT`).catch(() => {})
}

export async function saveTask(t: StoredTask): Promise<void> {
  const patch = {
    notBefore: t.notBefore ?? null,
    lastNote: t.lastNote ?? null,
    userMessage: t.userMessage,
    question: t.question ?? null,
    options: t.options ? JSON.stringify(t.options) : null,
    askedAt: t.askedAt ?? null,
    files: t.files?.length ? JSON.stringify(t.files) : null,
  }
  await useDb().insert(cockpitTasks).values({
    id: t.id,
    ownerEmail: t.owner,
    orgId: t.company,
    systemPrompt: t.systemPrompt,
    createdAt: t.createdAt,
    ...patch,
  }).onConflictDoUpdate({ target: cockpitTasks.id, set: patch })
}

export async function removeTask(id: string): Promise<void> {
  await useDb().delete(cockpitTasks).where(eq(cockpitTasks.id, id))
}

// Return the in-flight tasks worth resuming and prune the stale ones (older than
// maxAgeMs — the worker never ran them, dropping is correct). Open questions get
// their own, much longer window: a human answers in hours or days, not minutes.
export async function loadAndPrunePending(maxAgeMs: number, now: number): Promise<StoredTask[]> {
  await ensureTaskTable()
  const db = useDb()
  const effectiveAge = sql`max(${cockpitTasks.createdAt}, coalesce(${cockpitTasks.notBefore}, ${cockpitTasks.createdAt}), coalesce(${cockpitTasks.askedAt}, ${cockpitTasks.createdAt}))`
  await db.delete(cockpitTasks).where(
    sql`(${cockpitTasks.question} IS NULL AND ${lt(effectiveAge, now - maxAgeMs)}) OR (${cockpitTasks.question} IS NOT NULL AND ${lt(effectiveAge, now - ASK_MAX_AGE_MS)})`,
  )
  const rows = await db.select().from(cockpitTasks)
  return rows.map(r => ({
    id: r.id,
    company: r.orgId,
    owner: r.ownerEmail,
    systemPrompt: r.systemPrompt,
    userMessage: r.userMessage,
    createdAt: r.createdAt,
    notBefore: r.notBefore ?? undefined,
    lastNote: r.lastNote ?? undefined,
    question: r.question ?? undefined,
    options: r.options ? JSON.parse(r.options) as string[] : undefined,
    askedAt: r.askedAt ?? undefined,
    files: r.files ? JSON.parse(r.files) as { id: string, mime: string, name: string }[] : undefined,
  }))
}
