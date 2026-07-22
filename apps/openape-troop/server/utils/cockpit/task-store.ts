import { eq, lt, sql } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { cockpitTasks } from '../../database/schema'

// Durability layer for the in-memory queue: persist an in-flight task's input,
// forget it on terminal resolve, reload the unfinished ones on boot. Best-effort
// (callers fire-and-forget) — an occasional orphan self-heals in one cycle.

export interface StoredTask { id: string, company: string, owner: string, systemPrompt: string, userMessage: string, createdAt: number, notBefore?: number, lastNote?: string }

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
    last_note TEXT
  )`)
  await useDb().run(sql`ALTER TABLE cockpit_tasks ADD COLUMN not_before INTEGER`).catch(() => {})
  await useDb().run(sql`ALTER TABLE cockpit_tasks ADD COLUMN last_note TEXT`).catch(() => {})
}

export async function saveTask(t: StoredTask): Promise<void> {
  await useDb().insert(cockpitTasks).values({
    id: t.id,
    ownerEmail: t.owner,
    orgId: t.company,
    systemPrompt: t.systemPrompt,
    userMessage: t.userMessage,
    createdAt: t.createdAt,
    notBefore: t.notBefore,
    lastNote: t.lastNote,
  }).onConflictDoUpdate({ target: cockpitTasks.id, set: { notBefore: t.notBefore, lastNote: t.lastNote } })
}

export async function removeTask(id: string): Promise<void> {
  await useDb().delete(cockpitTasks).where(eq(cockpitTasks.id, id))
}

// Return the in-flight tasks worth resuming and prune the stale ones (older than
// maxAgeMs — the worker never ran them, dropping is correct).
export async function loadAndPrunePending(maxAgeMs: number, now: number): Promise<StoredTask[]> {
  await ensureTaskTable()
  const db = useDb()
  await db.delete(cockpitTasks).where(lt(sql`max(${cockpitTasks.createdAt}, coalesce(${cockpitTasks.notBefore}, ${cockpitTasks.createdAt}))`, now - maxAgeMs))
  const rows = await db.select().from(cockpitTasks)
  return rows.map(r => ({ id: r.id, company: r.orgId, owner: r.ownerEmail, systemPrompt: r.systemPrompt, userMessage: r.userMessage, createdAt: r.createdAt, notBefore: r.notBefore ?? undefined, lastNote: r.lastNote ?? undefined }))
}
