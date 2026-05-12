// In-memory registry of nest daemons currently connected via WS.
// One owner can have multiple Macs ("hosts") connected — each gets its
// own row keyed by (ownerEmail, hostId). When a config-update needs to
// fan out, we look up every peer for the owner; when a spawn-intent
// targets a specific Mac, we look up by exact (owner, host).
//
// Single-process today. If troop ever scales horizontally this is the
// piece that needs Redis pub/sub — same shape as the chat-app's
// realtime registry (which served as the template). For now the
// chatty.delta-mind.at deployment is one node, one process.

export interface NestPeer {
  ownerEmail: string
  hostId: string
  hostname: string
  version: string
  /** Wall-clock seconds at last hello / heartbeat — drives the
   *  online-badge in the troop UI + the "is this peer stale" cleanup
   *  in close handlers. */
  lastSeenAt: number
  /** Send a frame to this peer. Returns false if the socket is gone. */
  send: (frame: Record<string, unknown>) => boolean
  /** Stable identifier for the underlying crossws peer; used as the
   *  cleanup key when the WS close handler fires. */
  peerId: string
}

const peersByKey = new Map<string, NestPeer>()

function keyFor(ownerEmail: string, hostId: string): string {
  return `${ownerEmail.toLowerCase()}::${hostId}`
}

export function registerNestPeer(peer: NestPeer): void {
  peersByKey.set(keyFor(peer.ownerEmail, peer.hostId), peer)
}

export function unregisterNestPeerById(peerId: string): void {
  for (const [k, p] of peersByKey) {
    if (p.peerId === peerId) {
      peersByKey.delete(k)
      return
    }
  }
}

export function touchNestPeer(peerId: string): void {
  for (const p of peersByKey.values()) {
    if (p.peerId === peerId) {
      p.lastSeenAt = Math.floor(Date.now() / 1000)
      return
    }
  }
}

export function getNestPeer(ownerEmail: string, hostId: string): NestPeer | undefined {
  return peersByKey.get(keyFor(ownerEmail, hostId))
}

export function listNestPeersForOwner(ownerEmail: string): NestPeer[] {
  const out: NestPeer[] = []
  const prefix = `${ownerEmail.toLowerCase()}::`
  for (const [k, p] of peersByKey) {
    if (k.startsWith(prefix)) out.push(p)
  }
  return out
}

/**
 * Fan-out frame to every nest connected for the given owner. Returns
 * the count of peers it was successfully sent to — callers can log
 * this so silent failures (zero connected nests) are diagnosable.
 */
export function broadcastToOwner(ownerEmail: string, frame: Record<string, unknown>): number {
  let sent = 0
  for (const peer of listNestPeersForOwner(ownerEmail)) {
    if (peer.send(frame)) sent++
  }
  return sent
}

// Exported for tests. Unique name to avoid colliding with the
// equivalent symbol in spawn-intents.ts (Nuxt server auto-imports
// scan this directory and warn on duplicate exports).
export const _nestRegistryInternal = { peersByKey }
