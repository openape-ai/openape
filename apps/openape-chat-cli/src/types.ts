// Wire shapes returned by chat.openape.ai. Kept in lock-step with
// apps/openape-chat/server/{database/schema.ts, api/...}. If the chat app
// schema drifts these will break visibly at runtime — fail loud, fix here.

export interface Room {
  id: string
  name: string
  // Only `dm` rooms exist after the channel-removal in #276; the type
  // is kept as a union of one for forward-compat (room kinds like
  // 'group' may come back as a contact-driven primitive later).
  kind: 'dm'
  createdByEmail: string
  createdAt: number
}

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

export interface Thread {
  id: string
  roomId: string
  name: string
  createdByEmail: string
  createdAt: number
  archivedAt: number | null
}

export interface Member {
  userEmail: string
  role: 'admin' | 'member'
  joinedAt: number
}

export type WsFrameType
  = | 'message'
    | 'reaction'
    | 'reaction-removed'
    | 'edit'
    | 'membership-added'
    | 'membership-changed'
    | 'membership-removed'

export interface WsFrame {
  type: WsFrameType
  room_id: string
  payload: Record<string, unknown>
}
