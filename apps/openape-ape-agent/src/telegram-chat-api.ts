// Telegram implementation of the bridge's ChatBackend. The agent posts and
// edits messages DIRECTLY via the Bot API — no troop round-trip. Mirrors the
// streaming contract ThreadSession expects (post empty placeholder → patch →
// final patch with streaming:false), mapped onto Telegram's verbs:
//
//   postMessage(empty)        → sendMessage('…')   (placeholder; Telegram
//                                                    forbids empty text)
//   patchMessage(streaming!=false) → no-op          (M0: skip intermediate
//                                                    edits to stay under
//                                                    Telegram's edit rate cap)
//   patchMessage(streaming==false) → editMessageText (the final answer)
//
// Live token-by-token streaming (editMessageText per chunk, throttled) is an
// M1 enhancement; M0 shows a "…" placeholder that becomes the full answer.

import type { ChatBackend, ContactView, HistoryMessage, PostedMessage } from './troop-chat-api'
import type { TelegramTransport } from './telegram-api'
import { chatIdParam } from './telegram-api'

const PLACEHOLDER_TEXT = '…'
const SYNTHETIC_THREAD_ID = 'main'

interface SentMessage {
  message_id: number
  date?: number
}

/** Encode (chatId, messageId) into the single id string patchMessage receives. */
function encodeId(roomId: string, messageId: number): string {
  return `${roomId}|${messageId}`
}

function decodeId(id: string): { chatId: string | number, messageId: number } {
  const i = id.lastIndexOf('|')
  return { chatId: chatIdParam(id.slice(0, i)), messageId: Number(id.slice(i + 1)) }
}

export class TelegramChatApi implements ChatBackend {
  constructor(private call: TelegramTransport) {}

  async postMessage(
    roomId: string,
    body: string,
    opts: { replyTo?: string, threadId?: string, streaming?: boolean } = {},
  ): Promise<PostedMessage> {
    const text = body.length > 0 ? body : PLACEHOLDER_TEXT
    const params: Record<string, unknown> = { chat_id: chatIdParam(roomId), text }
    if (opts.threadId && opts.threadId !== SYNTHETIC_THREAD_ID) {
      params.message_thread_id = Number(opts.threadId)
    }
    if (opts.replyTo && /^\d+$/.test(opts.replyTo)) {
      params.reply_parameters = { message_id: Number(opts.replyTo), allow_sending_without_reply: true }
    }
    const res = await this.call('sendMessage', params)
    if (!res.ok || !res.result) {
      throw new Error(`telegram sendMessage failed: ${res.description ?? 'unknown error'}`)
    }
    const sent = res.result as SentMessage
    return {
      id: encodeId(roomId, sent.message_id),
      roomId,
      threadId: opts.threadId ?? SYNTHETIC_THREAD_ID,
      body: text,
      createdAt: sent.date ?? Math.floor(Date.now() / 1000),
    }
  }

  async patchMessage(
    messageId: string,
    opts: { body?: string, streaming?: boolean, streamingStatus?: string | null } = {},
  ): Promise<void> {
    // M0: only the final edit lands. Intermediate body patches and status
    // patches are dropped — Telegram has no "typing status" row and editing
    // on every 300ms throttle tick would blow the per-message edit rate cap.
    if (opts.streaming !== false || opts.body === undefined) return
    const { chatId, messageId: msgId } = decodeId(messageId)
    const res = await this.call('editMessageText', {
      chat_id: chatId,
      message_id: msgId,
      text: opts.body.length > 0 ? opts.body : PLACEHOLDER_TEXT,
    })
    // "message is not modified" happens when the final text equals the
    // placeholder (e.g. an empty answer) — harmless, swallow it.
    if (!res.ok && !/not modified/i.test(res.description ?? '')) {
      throw new Error(`telegram editMessageText failed: ${res.description ?? 'unknown error'}`)
    }
  }

  // Telegram exposes no history-fetch API. A live ThreadSession keeps its own
  // in-process history across turns; only a bridge restart loses Telegram
  // context (acceptable for M0 — persisted backfill is later work).
  async listMessages(): Promise<HistoryMessage[]> {
    return []
  }

  // Contacts are a troop concept; the Telegram inbound path never invokes the
  // bridge's contact handshake, so these are inert stand-ins for the interface.
  async listContacts(): Promise<ContactView[]> {
    return []
  }

  async requestContact(peerEmail: string): Promise<ContactView> {
    return { peerEmail, myStatus: 'accepted', theirStatus: 'accepted', connected: true, roomId: null }
  }

  async acceptContact(peerEmail: string): Promise<ContactView> {
    return { peerEmail, myStatus: 'accepted', theirStatus: 'accepted', connected: true, roomId: null }
  }

  // M0 has no Telegram threads; forum-topic creation is M1.
  async createThread(roomId: string, name: string): Promise<{ id: string, name: string }> {
    void roomId
    return { id: SYNTHETIC_THREAD_ID, name: name.slice(0, 100) }
  }
}
