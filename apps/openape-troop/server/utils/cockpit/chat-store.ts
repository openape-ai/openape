import { randomUUID } from 'node:crypto'
import { and, asc, eq, gt } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { cockpitChatMessages, organizations } from '../../database/schema'
import { pushToOwner } from './push'

export type ChatRole = 'user' | 'assistant'

// An open question rendered as chips in the chat; `answered` flips when the
// owner picks (or the task dies) so a reload never shows live chips on a dead ask.
export interface ChatMeta { taskId: string, options: string[], answered?: boolean, progress?: boolean, progressFirst?: boolean }

const progressSavedAt = new Map<string, number>()
const progressPushSent = new Set<string>()
const PROGRESS_INTERVAL_MS = 60_000

// Persist one message of the (owner, org) conversation. Independent of any live
// stream — the answer survives even if the client is gone.
export async function saveChatMessage(orgId: string, owner: string, role: ChatRole, content: string, meta?: ChatMeta, files?: { id: string, mime: string, name: string }[]) {
  const db = useDb()
  const row = { id: randomUUID(), ownerEmail: owner, orgId, role, content, meta: meta ?? null, files: files?.length ? files : null, createdAt: Date.now() }
  await db.insert(cockpitChatMessages).values(row)
  // A Operator answer → notify the owner's installed PWA / browsers (fire-and-forget,
  // never blocks or fails the save). The SW suppresses it if a tab is focused.
  if (role === 'assistant' && (!meta?.progress || meta.progressFirst)) {
    const org = await db.select({ name: organizations.name }).from(organizations).where(and(eq(organizations.id, orgId), eq(organizations.ownerEmail, owner))).get()
    const orgName = org?.name ?? orgId
    void pushToOwner(owner, { title: orgName, body: `Troop-Chat · ${content.slice(0, 120)}`, url: '/chat' }).catch(() => {})
  }
  return row
}

// Persist at most one live progress note per task and minute. The first note
// may notify the owner; later notes are intentionally quiet.
export async function saveProgressChatMessage(orgId: string, owner: string, taskId: string, content: string) {
  const now = Date.now()
  const last = progressSavedAt.get(taskId) ?? 0
  if (now - last < PROGRESS_INTERVAL_MS) return null
  progressSavedAt.set(taskId, now)
  const first = !progressPushSent.has(taskId)
  progressPushSent.add(taskId)
  return saveChatMessage(orgId, owner, 'assistant', content, { taskId, options: [], progress: true, progressFirst: first })
}

// The owner answered (or the task is gone): chips render as settled from now on.
export async function markAskAnswered(orgId: string, owner: string, taskId: string) {
  const rows = await useDb().select().from(cockpitChatMessages).where(and(eq(cockpitChatMessages.ownerEmail, owner), eq(cockpitChatMessages.orgId, orgId)))
  for (const r of rows) {
    const meta = r.meta as ChatMeta | null
    if (meta?.taskId === taskId && !meta.answered)
      await useDb().update(cockpitChatMessages).set({ meta: { ...meta, answered: true } }).where(eq(cockpitChatMessages.id, r.id))
  }
}

// The conversation, oldest-first, optionally only newer than `sinceMs` (for polling).
export async function loadChat(orgId: string, owner: string, sinceMs = 0) {
  return useDb().select().from(cockpitChatMessages).where(and(eq(cockpitChatMessages.ownerEmail, owner), eq(cockpitChatMessages.orgId, orgId), gt(cockpitChatMessages.createdAt, sinceMs))).orderBy(asc(cockpitChatMessages.createdAt))
}

// Clear the conversation for one company (the "Neu"/clear action).
export async function deleteChat(orgId: string, owner: string) {
  await useDb().delete(cockpitChatMessages).where(and(eq(cockpitChatMessages.ownerEmail, owner), eq(cockpitChatMessages.orgId, orgId)))
}
