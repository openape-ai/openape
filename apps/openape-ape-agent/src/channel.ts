// A Channel is one inbound+outbound surface the bridge talks chat over.
// Today the bridge has the troop channel (WebSocket inbound + TroopChatApi
// outbound). Adapters like Telegram plug in here as additional channels:
// the agent communicates DIRECTLY with the messenger, not through troop.
// Each channel owns its outbound ChatBackend; its inbound source (push or
// poll) feeds normalized Messages into the bridge via the InboundHandler,
// which carries the originating backend so replies go back out the same way.

import type { ChatBackend } from './troop-chat-api'

/**
 * Normalized inbound chat message. roomIds are disjoint across channels
 * (a troop chat ULID never collides with a Telegram chat id), so the
 * bridge's `${roomId}:${threadId}` thread key stays globally unique and
 * each thread binds to exactly one backend.
 */
export interface Message {
  id: string
  roomId: string
  threadId: string
  senderEmail: string
  senderAct: 'human' | 'agent'
  body: string
  replyTo: string | null
  createdAt: number
  editedAt: number | null
}

/**
 * Called by a channel for each inbound message. `backend` is the channel's
 * own outbound surface — the bridge uses it to post the agent's reply (and
 * any refusal) back to the same channel.
 */
export type InboundHandler = (msg: Message, backend: ChatBackend) => void | Promise<void>

export interface Channel {
  readonly name: string
  /** Run the channel's inbound loop forever, delivering messages to `onInbound`. */
  start: (onInbound: InboundHandler) => Promise<void>
}
