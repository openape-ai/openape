// Telegram inbound: long-poll getUpdates, owner-lock to one Telegram user,
// map each text message to the bridge's normalized Message, and hand it to
// the InboundHandler with the Telegram backend so the reply goes back out
// the same channel. The agent talks to Telegram directly — troop is not in
// this path.

import type { ChatBackend } from './troop-chat-api'
import type { Channel, InboundHandler, Message } from './channel'
import type { TelegramTransport } from './telegram-api'
import { chatIdParam } from './telegram-api'

const LONG_POLL_SECONDS = 30
const POLL_ERROR_BACKOFF_MS = 3000

interface TgUser {
  id: number
}

interface TgChat {
  id: number
}

interface TgMessage {
  message_id: number
  from?: TgUser
  chat: TgChat
  date?: number
  text?: string
  message_thread_id?: number
}

interface TgUpdate {
  update_id: number
  message?: TgMessage
}

export interface TelegramChannelDeps {
  call: TelegramTransport
  /**
   * The Telegram user id allowed to drive the bot. When undefined, the channel
   * trusts the first user who messages it (TOFU) and pins them via saveOwnerPin.
   */
  ownerUserId?: number
  /** Load a previously-pinned owner id (e.g. from disk) so a restart keeps the lock. */
  loadOwnerPin?: () => number | undefined
  /** Persist a freshly-pinned owner id. */
  saveOwnerPin?: (id: number) => void
  /** The agent's owner email — stamped on inbound so the injection gate treats it as the owner. */
  ownerEmail: string
  backend: ChatBackend
  log: (line: string) => void
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class TelegramChannel implements Channel {
  readonly name = 'telegram'
  private offset = 0
  // Chats we've already told "not authorized" — one hint per chat, not per message.
  private warned = new Set<number>()
  // The locked owner: explicit id, else a previously-pinned one, else undefined
  // until the first message pins it (TOFU).
  private owner: number | undefined

  constructor(private deps: TelegramChannelDeps) {
    this.owner = deps.ownerUserId ?? deps.loadOwnerPin?.()
  }

  async start(onInbound: InboundHandler): Promise<void> {
    await this.skipBacklog()
    this.deps.log('telegram channel up')
    while (true) {
      let updates: TgUpdate[] = []
      try {
        updates = await this.poll()
      }
      catch (err) {
        this.deps.log(`telegram poll error: ${err instanceof Error ? err.message : String(err)}`)
        await sleep(POLL_ERROR_BACKOFF_MS)
        continue
      }
      for (const u of updates) {
        this.offset = Math.max(this.offset, u.update_id + 1)
        await this.dispatch(u, onInbound)
      }
    }
  }

  /**
   * On boot, advance the offset past any messages Telegram buffered while the
   * bridge was down (it holds updates ~24h) so a restart doesn't replay a
   * day of old messages as fresh turns.
   */
  private async skipBacklog(): Promise<void> {
    const res = await this.deps.call('getUpdates', { timeout: 0, offset: -1 })
    if (res.ok && Array.isArray(res.result) && res.result.length > 0) {
      const updates = res.result as TgUpdate[]
      const last = updates.at(-1)!
      this.offset = last.update_id + 1
      this.deps.log(`telegram: skipped ${updates.length} backlog update(s) on boot`)
    }
  }

  private async poll(): Promise<TgUpdate[]> {
    const res = await this.deps.call('getUpdates', { timeout: LONG_POLL_SECONDS, offset: this.offset })
    if (!res.ok) {
      throw new Error(res.description ?? 'getUpdates failed')
    }
    return Array.isArray(res.result) ? (res.result as TgUpdate[]) : []
  }

  private async dispatch(u: TgUpdate, onInbound: InboundHandler): Promise<void> {
    const m = u.message
    if (!m || typeof m.text !== 'string' || m.text.length === 0) return
    const from = m.from?.id
    if (from === undefined) return

    if (this.owner === undefined) {
      // Trust on first use: the first user to message a freshly-bound bot is
      // its owner (in practice the person who just created it). Pin + persist.
      this.owner = from
      this.deps.saveOwnerPin?.(from)
      this.deps.log(`telegram: owner pinned to user ${from} on first contact`)
    }
    else if (from !== this.owner) {
      await this.refuseStranger(m)
      return
    }

    // Telegram clients auto-send /start on first open — greet, don't forward it.
    if (m.text === '/start' || m.text.startsWith('/start ')) {
      await this.reply(m.chat.id, 'Hi 👋 — schreib mir einfach, ich bin dein Agent und antworte direkt hier.', m.message_thread_id)
      return
    }

    const msg: Message = {
      id: String(m.message_id),
      roomId: String(m.chat.id),
      threadId: m.message_thread_id ? String(m.message_thread_id) : 'main',
      senderEmail: this.deps.ownerEmail,
      senderAct: 'human',
      body: m.text,
      replyTo: null,
      createdAt: m.date ?? Math.floor(Date.now() / 1000),
      editedAt: null,
    }
    await onInbound(msg, this.deps.backend)
  }

  private async refuseStranger(m: TgMessage): Promise<void> {
    if (this.warned.has(m.chat.id)) return
    this.warned.add(m.chat.id)
    this.deps.log(`telegram: ignoring message from non-owner user ${m.from?.id ?? 'unknown'}`)
    await this.reply(m.chat.id, 'Dieser Bot ist privat und nur für seinen Owner.', m.message_thread_id)
  }

  private async reply(chatId: number, text: string, threadId?: number): Promise<void> {
    const params: Record<string, unknown> = { chat_id: chatIdParam(String(chatId)), text }
    if (threadId) params.message_thread_id = threadId
    try {
      await this.deps.call('sendMessage', params)
    }
    catch (err) {
      this.deps.log(`telegram reply failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
