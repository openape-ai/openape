// Troop-native chat client. Troop's chat is simpler than
// chat.openape.ai's: one persistent chat per (owner, agent) pair,
// no contacts dance, no threads. We synthesize chat-shaped responses
// the rest of the bridge code (cron-runner, thread-session,
// contact-allowlist flow) expects.

import { ofetch } from 'ofetch'

export interface PostedMessage {
  id: string
  roomId: string
  threadId: string
  body: string
  createdAt: number
}

/**
 * One row from chat history. Used by the bridge to backfill
 * ThreadSession message history after a process restart.
 */
export interface HistoryMessage {
  id: string
  roomId: string
  threadId: string
  senderEmail: string
  senderAct: 'human' | 'agent'
  body: string
  replyTo: string | null
  createdAt: number
}

export interface ContactView {
  peerEmail: string
  myStatus: 'accepted' | 'pending' | 'blocked'
  theirStatus: 'accepted' | 'pending' | 'blocked'
  connected: boolean
  roomId: string | null
}

/**
 * Structural interface both the cron-runner and thread-session use
 * so their call sites stay backend-agnostic.
 */
export interface ChatBackend {
  postMessage: (roomId: string, body: string, opts?: { replyTo?: string, threadId?: string, streaming?: boolean }) => Promise<PostedMessage>
  listMessages: (roomId: string, threadId: string, limit?: number) => Promise<HistoryMessage[]>
  patchMessage: (messageId: string, opts?: { body?: string, streaming?: boolean, streamingStatus?: string | null }) => Promise<void>
  listContacts: () => Promise<ContactView[]>
  requestContact: (peerEmail: string) => Promise<ContactView>
  acceptContact: (peerEmail: string) => Promise<ContactView>
  createThread: (roomId: string, name: string) => Promise<{ id: string, name: string }>
}

interface TroopChat {
  id: string
  ownerEmail: string
  agentEmail: string
  createdAt: number
  lastMessageAt: number | null
}

interface TroopChatMessage {
  id: string
  chatId: string
  role: 'human' | 'agent'
  body: string
  createdAt: number
  editedAt: number | null
  streaming: boolean
  streamingStatus: string | null
  replyTo: string | null
}

interface TroopChatBootstrap {
  chat: TroopChat
  messages: TroopChatMessage[]
}

const MAX_BODY = 64 * 1024
const SYNTHETIC_THREAD_ID = 'main'

/**
 * Map a troop ChatMessage into the chat.openape.ai HistoryMessage
 * shape the bridge expects. role='human' means the owner sent it;
 * we substitute the owner's email so existing senderEmail-equality
 * checks (msg.senderEmail === this.ownerEmail) still work.
 */
function asHistory(msg: TroopChatMessage, agentEmail: string, ownerEmail: string): HistoryMessage {
  return {
    id: msg.id,
    roomId: msg.chatId,
    threadId: SYNTHETIC_THREAD_ID,
    senderEmail: msg.role === 'agent' ? agentEmail : ownerEmail,
    senderAct: msg.role,
    body: msg.body,
    replyTo: msg.replyTo,
    createdAt: msg.createdAt,
  }
}

function asPosted(msg: TroopChatMessage): PostedMessage {
  return {
    id: msg.id,
    roomId: msg.chatId,
    threadId: SYNTHETIC_THREAD_ID,
    body: msg.body,
    createdAt: msg.createdAt,
  }
}

export class TroopChatApi {
  private bootstrap: TroopChatBootstrap | null = null

  constructor(private endpoint: string, private bearer: () => Promise<string>) {}

  /** Resolve + cache the agent's chat row (lazy fetch on first use). */
  private async getBootstrap(): Promise<TroopChatBootstrap> {
    if (this.bootstrap) return this.bootstrap
    this.bootstrap = await ofetch<TroopChatBootstrap>(`${this.endpoint}/api/agents/me/chat`, {
      method: 'GET',
      headers: { Authorization: await this.bearer() },
    })
    return this.bootstrap
  }

  /** chat.id + (lazy-fetched) ownerEmail for the bridge's frame-translation path. */
  async getChatContext(): Promise<{ chatId: string, ownerEmail: string, agentEmail: string }> {
    const b = await this.getBootstrap()
    return { chatId: b.chat.id, ownerEmail: b.chat.ownerEmail, agentEmail: b.chat.agentEmail }
  }

  async postMessage(
    roomId: string,
    body: string,
    opts: { replyTo?: string, threadId?: string, streaming?: boolean } = {},
  ): Promise<PostedMessage> {
    // roomId arg is ignored — troop derives the chat from the agent
    // JWT (act='agent' + sub=agentEmail). Documented so the bridge's
    // call sites don't need to change shape.
    void roomId
    void opts.threadId
    const payload: Record<string, unknown> = {
      body: body.length > MAX_BODY ? `${body.slice(0, MAX_BODY - 1)}…` : body,
    }
    if (opts.replyTo) payload.reply_to = opts.replyTo
    if (opts.streaming) payload.streaming = true
    const msg = await ofetch<TroopChatMessage>(`${this.endpoint}/api/agents/me/chat/messages`, {
      method: 'POST',
      headers: { Authorization: await this.bearer() },
      body: payload,
    })
    return asPosted(msg)
  }

  async listMessages(roomId: string, threadId: string, limit = 50): Promise<HistoryMessage[]> {
    void roomId
    void threadId
    void limit
    // Bootstrap already returned the recent page in chronological order;
    // re-fetch so we pick up anything that landed between connect and
    // backfill. listMessages is invoked once per ThreadSession, so the
    // cost of a fresh fetch is one HTTP round-trip.
    const fresh = await ofetch<TroopChatBootstrap>(`${this.endpoint}/api/agents/me/chat`, {
      method: 'GET',
      headers: { Authorization: await this.bearer() },
    })
    this.bootstrap = fresh
    return fresh.messages.map(m => asHistory(m, fresh.chat.agentEmail, fresh.chat.ownerEmail))
  }

  async patchMessage(
    messageId: string,
    opts: { body?: string, streaming?: boolean, streamingStatus?: string | null } = {},
  ): Promise<void> {
    const payload: Record<string, unknown> = {}
    if (opts.body !== undefined) {
      payload.body = opts.body.length > MAX_BODY ? `${opts.body.slice(0, MAX_BODY - 1)}…` : opts.body
    }
    if (opts.streaming !== undefined) payload.streaming = opts.streaming
    if (opts.streamingStatus !== undefined) payload.streaming_status = opts.streamingStatus
    if (Object.keys(payload).length === 0) return
    await ofetch(`${this.endpoint}/api/agents/me/chat/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH',
      headers: { Authorization: await this.bearer() },
      body: payload,
    })
  }

  /**
   * Troop's chat doesn't have contacts — synthesize a single
   *  always-connected entry pointing at the owner so the bridge's
   *  initial-contact + allowlist flows are no-ops.
   */
  async listContacts(): Promise<ContactView[]> {
    const b = await this.getBootstrap()
    return [{
      peerEmail: b.chat.ownerEmail,
      myStatus: 'accepted',
      theirStatus: 'accepted',
      connected: true,
      roomId: b.chat.id,
    }]
  }

  async requestContact(peerEmail: string): Promise<ContactView> {
    // No-op — troop registration of the (owner, agent) pair happens at
    // agent-create time, not via a contact-handshake.
    void peerEmail
    return (await this.listContacts())[0]!
  }

  async acceptContact(peerEmail: string): Promise<ContactView> {
    void peerEmail
    return (await this.listContacts())[0]!
  }

  /**
   * Troop has no threads — return a synthetic one. The bridge's
   *  cron-runner falls back to the main thread on createThread
   *  failure already, so a stable "main" stand-in is the right shape.
   */
  async createThread(roomId: string, name: string): Promise<{ id: string, name: string }> {
    void roomId
    return { id: SYNTHETIC_THREAD_ID, name: name.slice(0, 100) }
  }
}
