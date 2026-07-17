import { eq, lt } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { cockpitTasks } from '../../database/schema'

// Durability layer for the in-memory queue: persist an in-flight task's input,
// forget it on terminal resolve, reload the unfinished ones on boot. Best-effort
// (callers fire-and-forget) — an occasional orphan self-heals in one cycle.

export interface StoredTask { id: string, company: string, owner: string, systemPrompt: string, userMessage: string, createdAt: number }

export async function saveTask(t: StoredTask): Promise<void> {
  await useDb().insert(cockpitTasks).values({
    id: t.id,
    ownerEmail: t.owner,
    orgId: t.company,
    systemPrompt: t.systemPrompt,
    userMessage: t.userMessage,
    createdAt: t.createdAt,
  }).onConflictDoNothing()
}

export async function removeTask(id: string): Promise<void> {
  await useDb().delete(cockpitTasks).where(eq(cockpitTasks.id, id))
}

// Return the in-flight tasks worth resuming and prune the stale ones (older than
// maxAgeMs — the worker never ran them, dropping is correct).
export async function loadAndPrunePending(maxAgeMs: number, now: number): Promise<StoredTask[]> {
  const db = useDb()
  await db.delete(cockpitTasks).where(lt(cockpitTasks.createdAt, now - maxAgeMs))
  const rows = await db.select().from(cockpitTasks)
  return rows.map(r => ({ id: r.id, company: r.orgId, owner: r.ownerEmail, systemPrompt: r.systemPrompt, userMessage: r.userMessage, createdAt: r.createdAt }))
}
