// Wire shapes returned by chat.openape.ai. Kept in lock-step with
// apps/openape-chat/server/{database/schema.ts, api/...}. If the chat app
// schema drifts these will break visibly at runtime — fail loud, fix here.

export interface Room {
  id: string
  name: string
  kind: 'channel' | 'dm'
  createdByEmail: string
  createdAt: number
  /** Caller's role in the room. Only present on `GET /api/rooms`. */
  role?: 'admin' | 'member'
}

export interface Message {
  id: string
  roomId: string
  senderEmail: string
  senderAct: 'human' | 'agent'
  body: string
  replyTo: string | null
  createdAt: number
  editedAt: number | null
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
