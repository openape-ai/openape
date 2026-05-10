// In-memory registry of which user is currently *focused* on which chat
// surface. The client sends `focus` / `blur` frames on the WS connection
// when the user enters/leaves a room+thread (and when the tab toggles
// visibility). We use it for one thing only: suppress web-push delivery
// to a recipient who is already looking at the same room+thread on at
// least one connected device — sending a push there is just noise.
//
// Trade-offs:
//   - Process-local map. If chat ever scales horizontally we'd need to
//     move it to Redis or rely on sticky sessions. Today it's fine: one
//     systemd service, one process, all WS connections terminate here.
//   - Multi-device aware: a single user may have multiple peers focused
//     at once (e.g. desktop + phone both viewing the same room). The
//     map is keyed by peer id, not user, so each device contributes one
//     row. `isUserFocusedOn` returns true if *any* of that user's peers
//     has the matching focus — that's "if you're looking at this
//     anywhere, you don't need a push anywhere."
//   - WS close clears that peer's focus automatically. So crashed tabs
//     drop out within seconds.

interface FocusRow {
  email: string
  roomId: string
  // thread_id is optional: the client may not yet know which thread it
  // landed on (loading state), in which case it sends focus with just
  // a room id. Room-level focus suppresses push for the whole room —
  // safer than over-notifying.
  threadId?: string
}

const focusByPeer = new Map<string, FocusRow>()

export function setFocus(peerId: string, row: FocusRow): void {
  focusByPeer.set(peerId, row)
}

export function clearFocusForPeer(peerId: string): void {
  focusByPeer.delete(peerId)
}

/**
 * Returns true when the user has at least one peer focused on this
 * room (and matching thread, if both sides know one). Used by the
 * push fan-out to skip delivery to recipients who'd just get a noise
 * notification for a message they're already staring at.
 */
export function isUserFocusedOn(email: string, roomId: string, threadId: string | undefined): boolean {
  for (const row of focusByPeer.values()) {
    if (row.email !== email) continue
    if (row.roomId !== roomId) continue
    // Thread match: if BOTH sides specify a thread, require equality.
    // If either side is room-level (no thread), count it as a match
    // (the user is at least in the room — pushing would be redundant).
    if (row.threadId && threadId && row.threadId !== threadId) continue
    return true
  }
  return false
}

// Exported for tests.
export const _internal = { focusByPeer }
