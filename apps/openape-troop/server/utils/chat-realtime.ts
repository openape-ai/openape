// In-memory WS broadcast hub for the troop chat (M4). Each connected
// peer is either:
//
//   - the owner's UI tab (subscribed to one or more chats — keyed by the
//     resolved chat ids)
//   - an agent's bridge process (subscribed to all chats where it is the
//     agent half)
//
// Messages, edits, streaming-status updates flow as JSON frames over the
// peer's WS. Single-process today; if/when troop scales horizontally this
// is the spot to plug in Redis pub/sub. Mirrors the shape of
// `openape-chat/server/utils/realtime.ts` so a future merge stays small.

export interface ChatPeer {
  send: (payload: string) => void
  // chats this peer is subscribed to. Mutated in place when the peer
  // sends a subscribe frame.
  chatIds: Set<string>
  // Identity of the peer — used for diagnostics + future auth tightening.
  email: string
}

const peers = new Set<ChatPeer>()

export function registerPeer(peer: ChatPeer): void {
  peers.add(peer)
}

export function unregisterPeer(peer: ChatPeer): void {
  peers.delete(peer)
}

export function peerCount(): number {
  return peers.size
}

export interface ChatFrame {
  type: 'message' | 'edit' | 'streaming-status' | 'subscribed'
  chat_id: string
  payload: Record<string, unknown>
}

/** Push a frame to every peer subscribed to `chatId`. */
export function broadcastToChat(chatId: string, frame: ChatFrame): void {
  if (peers.size === 0) return
  const json = JSON.stringify(frame)
  for (const peer of peers) {
    if (!peer.chatIds.has(chatId)) continue
    try { peer.send(json) }
    catch { /* peer gone; the close handler cleans up */ }
  }
}

/** Test-only. */
export function _resetPeers(): void {
  peers.clear()
}
