import { eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { memberships } from '../database/schema'

// In-memory broadcast hub. Holds one peer registry per process keyed by user
// email. When a message/reaction/edit happens we look up which users are
// members of the affected room and forward the frame to whatever sockets
// they have open. Single-process today; if we ever scale horizontally this
// becomes the place to swap in Redis pub/sub.

export interface ChatPeer {
  send: (payload: string) => void
  email: string
}

const peersByEmail = new Map<string, Set<ChatPeer>>()

export function registerPeer(peer: ChatPeer): void {
  let bucket = peersByEmail.get(peer.email)
  if (!bucket) {
    bucket = new Set()
    peersByEmail.set(peer.email, bucket)
  }
  bucket.add(peer)
}

export function unregisterPeer(peer: ChatPeer): void {
  const bucket = peersByEmail.get(peer.email)
  if (!bucket) return
  bucket.delete(peer)
  if (bucket.size === 0) peersByEmail.delete(peer.email)
}

export function peerCount(): number {
  let total = 0
  for (const set of peersByEmail.values()) total += set.size
  return total
}

export interface ChatFrame {
  type: 'message' | 'reaction' | 'reaction-removed' | 'edit'
    | 'membership-added' | 'membership-changed' | 'membership-removed'
  room_id: string
  payload: Record<string, unknown>
}

/**
 * Push a frame to every peer that is a member of `roomId`. Looks up
 * memberships at call time so adding a user to a room while they're
 * connected works without re-subscribing.
 */
export async function broadcastToRoom(roomId: string, frame: ChatFrame): Promise<void> {
  if (peersByEmail.size === 0) return

  const db = useDb()
  const members = await db
    .select({ userEmail: memberships.userEmail })
    .from(memberships)
    .where(eq(memberships.roomId, roomId))

  if (members.length === 0) return

  const json = JSON.stringify(frame)
  for (const m of members) {
    const bucket = peersByEmail.get(m.userEmail)
    if (!bucket) continue
    for (const peer of bucket) {
      try {
        peer.send(json)
      }
      catch {
        // Peer is gone or stalled; the close handler will clean it up.
      }
    }
  }
}

/** Test-only: clear the registry between specs. */
export function _resetPeerRegistry(): void {
  peersByEmail.clear()
}
