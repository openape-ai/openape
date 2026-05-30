// chats — per-agent persistent "main session" data access.
//
// The chat row is (ownerEmail, agentEmail) keyed; lazily created on the
// first message either side posts. Messages are append-only at the row
// level (PATCH only mutates body/streaming/streamingStatus while a
// streaming response is in flight; once streaming flips to false the
// row is immutable except for editedAt).

import { randomUUID } from 'node:crypto'
import { and, desc, eq, lt } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { agents, chatMessages, chats } from '../database/schema'
import type { Chat, ChatMessage, NewChatMessage } from '../database/schema'

export interface PostMessageInput {
  chatId: string
  role: 'human' | 'agent'
  body: string
  /**
   * When the bridge starts a streaming reply it inserts an empty row
   *  with streaming=true; subsequent PATCHes update body in-place
   *  without bumping editedAt until streaming=false.
   */
  streaming?: boolean
  streamingStatus?: string | null
  replyTo?: string | null
}

/** Find the chat between this owner + agent, or create it on the fly. */
export async function getOrCreateChat(input: {
  ownerEmail: string
  agentEmail: string
}): Promise<Chat> {
  const db = useDb()
  const existing = await db.select().from(chats).where(and(eq(chats.ownerEmail, input.ownerEmail), eq(chats.agentEmail, input.agentEmail))).limit(1)
  if (existing[0]) return existing[0]

  const row: Chat = {
    id: randomUUID(),
    ownerEmail: input.ownerEmail,
    agentEmail: input.agentEmail,
    createdAt: Math.floor(Date.now() / 1000),
    lastMessageAt: null,
  }
  await db.insert(chats).values(row)
  return row
}

/** Lookup by agent NAME (not email) — the convenience the UI uses. */
export async function getChatForAgentName(ownerEmail: string, agentName: string): Promise<Chat | null> {
  const db = useDb()
  const agentRow = await db.select({ email: agents.email })
    .from(agents)
    .where(and(eq(agents.agentName, agentName), eq(agents.ownerEmail, ownerEmail)))
    .limit(1)
  if (!agentRow[0]) return null
  return getOrCreateChat({ ownerEmail, agentEmail: agentRow[0].email })
}

export interface ListMessagesOptions {
  chatId: string
  /** Page back from this createdAt (exclusive). Omit for the most recent page. */
  before?: number
  /** Default 50, max 200. */
  limit?: number
}

/** Recent messages first; caller reverses for chronological display. */
export async function listMessages(opts: ListMessagesOptions): Promise<ChatMessage[]> {
  const db = useDb()
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const conds = [eq(chatMessages.chatId, opts.chatId)]
  if (opts.before) conds.push(lt(chatMessages.createdAt, opts.before))
  return db.select().from(chatMessages).where(and(...conds)).orderBy(desc(chatMessages.createdAt)).limit(limit)
}

export async function appendMessage(input: PostMessageInput): Promise<ChatMessage> {
  const db = useDb()
  const now = Math.floor(Date.now() / 1000)
  const row: NewChatMessage = {
    id: randomUUID(),
    chatId: input.chatId,
    role: input.role,
    body: input.body,
    createdAt: now,
    streaming: input.streaming ?? false,
    streamingStatus: input.streamingStatus ?? null,
    replyTo: input.replyTo ?? null,
  }
  await db.insert(chatMessages).values(row)
  // Bump the chat's lastMessageAt — non-fatal on race.
  await db.update(chats).set({ lastMessageAt: now }).where(eq(chats.id, input.chatId))
  const inserted = await db.select().from(chatMessages).where(eq(chatMessages.id, row.id)).limit(1)
  if (!inserted[0]) throw new Error(`chat_messages insert returned no row for ${row.id}`)
  return inserted[0]
}

export interface PatchMessageInput {
  id: string
  body?: string
  streaming?: boolean
  streamingStatus?: string | null
}

/**
 * Used by the bridge to update a streaming row in place + flip
 *  streaming off when the final delta lands. Bumps editedAt only when
 *  the row was already streaming=false (= true human edit).
 */
export async function patchMessage(input: PatchMessageInput): Promise<ChatMessage | null> {
  const db = useDb()
  const existing = await db.select().from(chatMessages).where(eq(chatMessages.id, input.id)).limit(1)
  if (!existing[0]) return null
  const wasStreaming = existing[0].streaming
  const updates: Partial<NewChatMessage> = {}
  if (input.body !== undefined) updates.body = input.body
  if (input.streaming !== undefined) updates.streaming = input.streaming
  if (input.streamingStatus !== undefined) updates.streamingStatus = input.streamingStatus
  // editedAt only ticks for true edits — not for streaming chunks.
  if (!wasStreaming && input.body !== undefined) {
    updates.editedAt = Math.floor(Date.now() / 1000)
  }
  await db.update(chatMessages).set(updates).where(eq(chatMessages.id, input.id))
  const after = await db.select().from(chatMessages).where(eq(chatMessages.id, input.id)).limit(1)
  return after[0] ?? null
}
