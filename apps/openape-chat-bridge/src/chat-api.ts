// Thin chat.openape.ai REST client used by the bridge to post + edit
// messages on behalf of the agent. Authenticates with the bearer the
// daemon's WebSocket already uses (refreshed by @openape/cli-auth).

import { ofetch } from 'ofetch'

export interface PostedMessage {
  id: string
  roomId: string
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

  async postMessage(roomId: string, body: string, replyTo?: string): Promise<PostedMessage> {
    const trimmed = clamp(body, MAX_BODY)
    const url = `${this.endpoint}/api/rooms/${encodeURIComponent(roomId)}/messages`
    const result = await ofetch<PostedMessage>(url, {
      method: 'POST',
      headers: { Authorization: await this.bearer() },
      body: replyTo ? { body: trimmed, reply_to: replyTo } : { body: trimmed },
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

  async patchMessage(messageId: string, body: string): Promise<void> {
    const trimmed = clamp(body, MAX_BODY)
    const url = `${this.endpoint}/api/messages/${encodeURIComponent(messageId)}`
    await ofetch(url, {
      method: 'PATCH',
      headers: { Authorization: await this.bearer() },
      body: { body: trimmed },
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
