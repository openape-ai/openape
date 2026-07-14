import { randomUUID } from 'node:crypto'
import { and, asc, eq, gt } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { cockpitChatMessages } from '../../database/schema'
import { pushToOwner } from './push'

export type ChatRole = 'user' | 'assistant'

// Persist one message of the (owner, org) conversation. Independent of any live
// stream — the answer survives even if the client is gone.
export async function saveChatMessage(orgId: string, owner: string, role: ChatRole, content: string) {
  const row = { id: randomUUID(), ownerEmail: owner, orgId, role, content, createdAt: Date.now() }
  await useDb().insert(cockpitChatMessages).values(row)
  // A CEO answer → notify the owner's installed PWA / browsers (fire-and-forget,
  // never blocks or fails the save). The SW suppresses it if a tab is focused.
  if (role === 'assistant')
    void pushToOwner(owner, { title: 'Troop-Chat', body: content.slice(0, 140), url: '/chat' }).catch(() => {})
  return row
}

// The conversation, oldest-first, optionally only newer than `sinceMs` (for polling).
export async function loadChat(orgId: string, owner: string, sinceMs = 0) {
  return useDb().select().from(cockpitChatMessages).where(and(eq(cockpitChatMessages.ownerEmail, owner), eq(cockpitChatMessages.orgId, orgId), gt(cockpitChatMessages.createdAt, sinceMs))).orderBy(asc(cockpitChatMessages.createdAt))
}

// Clear the conversation for one company (the "Neu"/clear action).
export async function deleteChat(orgId: string, owner: string) {
  await useDb().delete(cockpitChatMessages).where(and(eq(cockpitChatMessages.ownerEmail, owner), eq(cockpitChatMessages.orgId, orgId)))
}
