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
  // 'agent' peers (act='agent' bridges) get auto-subscribed to any
  // chat where chat.agentEmail === email at creation time. Without
  // this, an agent that connected BEFORE its chat row existed
  // (common: agent is up first, owner sends the first message later)
  // never sees the message because the chat.id isn't in chatIds.
  // 'human' peers must explicitly subscribe.
  kind: 'human' | 'agent'
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

/**
 * Called by getOrCreateChat() when a new chat row is inserted. Walk
 * every connected agent peer; if any has email === agentEmail, add
 * the new chatId to its subscription so the agent receives the
 * first message (the one that triggered the lazy chat creation).
 *
 * Without this, agents that booted before their chat existed
 * silently drop the first message: the bridge's WS is open but
 * chatIds is empty (preSubscribeAgent found no chat rows at
 * connect time), so broadcastToChat skips them on the very
 * broadcast that should reach them.
 */
export function notifyAgentChatCreated(chat: { id: string, agentEmail: string }): void {
  for (const peer of peers) {
    if (peer.kind !== 'agent') continue
    if (peer.email !== chat.agentEmail) continue
    if (peer.chatIds.has(chat.id)) continue
    peer.chatIds.add(chat.id)
    try {
      peer.send(JSON.stringify({
        type: 'subscribed',
        chat_id: chat.id,
        payload: { reason: 'auto-on-create' },
      }))
    }
    catch { /* peer gone; close handler cleans up */ }
  }
}

/** Test-only. */
export function _resetPeers(): void {
  peers.clear()
}
