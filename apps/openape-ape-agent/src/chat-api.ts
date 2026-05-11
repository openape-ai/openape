// Thin chat.openape.ai REST client used by the bridge to post + edit
// messages on behalf of the agent. Authenticates with the bearer the
// daemon's WebSocket already uses (refreshed by @openape/cli-auth).

import { ofetch } from 'ofetch'

export interface PostedMessage {
  id: string
  roomId: string
  threadId: string
  body: string
  createdAt: number
}

export interface ContactView {
  peerEmail: string
  myStatus: 'accepted' | 'pending' | 'blocked'
  theirStatus: 'accepted' | 'pending' | 'blocked'
  connected: boolean
  roomId: string | null
}

const MAX_BODY = 10_000

export class ChatApi {
  constructor(private endpoint: string, private bearer: () => Promise<string>) {}

  async postMessage(
    roomId: string,
    body: string,
    opts: { replyTo?: string, threadId?: string, streaming?: boolean } = {},
  ): Promise<PostedMessage> {
    // When streaming, empty body is fine — the server holds the
    // placeholder until the bridge starts patching tokens in. Outside
    // streaming, fall back to the legacy "…" placeholder so the
    // server's min-1-char rule keeps passing for compose-side users.
    const bodyForServer = opts.streaming ? body : clamp(body, MAX_BODY)
    const url = `${this.endpoint}/api/rooms/${encodeURIComponent(roomId)}/messages`
    const payload: Record<string, unknown> = { body: bodyForServer }
    if (opts.replyTo) payload.reply_to = opts.replyTo
    if (opts.threadId) payload.thread_id = opts.threadId
    if (opts.streaming) payload.streaming = true
    const result = await ofetch<PostedMessage>(url, {
      method: 'POST',
      headers: { Authorization: await this.bearer() },
      body: payload,
    })
    return result
  }

  async requestContact(peerEmail: string): Promise<ContactView> {
    const url = `${this.endpoint}/api/contacts`
    return await ofetch<ContactView>(url, {
      method: 'POST',
      headers: { Authorization: await this.bearer() },
      body: { email: peerEmail },
    })
  }

  async listContacts(): Promise<ContactView[]> {
    const url = `${this.endpoint}/api/contacts`
    return await ofetch<ContactView[]>(url, {
      method: 'GET',
      headers: { Authorization: await this.bearer() },
    })
  }

  async acceptContact(peerEmail: string): Promise<ContactView> {
    const url = `${this.endpoint}/api/contacts/${encodeURIComponent(peerEmail)}/accept`
    return await ofetch<ContactView>(url, {
      method: 'POST',
      headers: { Authorization: await this.bearer() },
    })
  }

  /**
   * Create a named thread in a room. Used by the cron-runner to drop
   * each task's runs into its own thread so the chat sidebar shows
   * one thread per task instead of all task DMs piling into the
   * main thread.
   */
  async createThread(roomId: string, name: string): Promise<{ id: string, name: string }> {
    const url = `${this.endpoint}/api/rooms/${encodeURIComponent(roomId)}/threads`
    return await ofetch<{ id: string, name: string }>(url, {
      method: 'POST',
      headers: { Authorization: await this.bearer() },
      body: { name: name.slice(0, 100) },
    })
  }

  /**
   * Update an in-flight or completed message. The server differentiates
   * three modes via the message's current `streaming` state and the
   * `streaming` field in this call:
   *
   *   - Stream tick: pass `body` only (current accumulated text).
   *     Server keeps streaming=true and does NOT bump edited_at.
   *   - Stream end: pass `body` + `streaming: false`. Server clears
   *     the streaming flag and triggers the user-facing push.
   *   - Tool-call status: pass `streamingStatus` only (no body).
   *     Renders as "🔧 time.now" in the typing-subtitle.
   *   - Tool-call cleared: pass `streamingStatus: null`.
   */
  async patchMessage(
    messageId: string,
    opts: { body?: string, streaming?: boolean, streamingStatus?: string | null } = {},
  ): Promise<void> {
    const url = `${this.endpoint}/api/messages/${encodeURIComponent(messageId)}`
    const payload: Record<string, unknown> = {}
    if (opts.body !== undefined) {
      // Outside the streaming-end transition, the server requires a
      // non-empty body. clamp() preserves that floor while letting the
      // bridge spam empty-string-during-streaming ticks pass through
      // for the placeholder-only case.
      payload.body = opts.streaming === false && opts.body.trim().length === 0
        ? clamp(opts.body, MAX_BODY)
        : (opts.body.length <= MAX_BODY ? opts.body : `${opts.body.slice(0, MAX_BODY - 1)}…`)
    }
    if (opts.streaming !== undefined) payload.streaming = opts.streaming
    if (opts.streamingStatus !== undefined) payload.streaming_status = opts.streamingStatus
    if (Object.keys(payload).length === 0) return
    await ofetch(url, {
      method: 'PATCH',
      headers: { Authorization: await this.bearer() },
      body: payload,
    })
  }
}

function clamp(s: string, max: number): string {
  // The chat-app rejects empty (after trim) and > 10kB bodies. Hard floor
  // at one printable char so the placeholder PATCH path can still send "…"
  // updates; ceiling at the schema limit so progressive accumulation
  // doesn't fail at message N when a later N+1 turn would have succeeded.
  if (s.trim().length === 0) return '…'
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

export { clamp as _clampBodyForTest }
