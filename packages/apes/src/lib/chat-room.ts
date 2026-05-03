// Helpers for `apes agents spawn --bridge`. Hits chat.openape.ai's REST
// API as the spawning user (uses their IdP bearer) to ensure a DM exists
// with the new agent. Auto-accepts both directions — the spawn act
// itself implies trust on the human side, and the agent has no policy
// of its own.
//
// Plain fetch here so apes stays free of a runtime npm dep on
// @openape/ape-chat. The shape mirrors openape-chat's server/api/rooms/*
// endpoints.

const DEFAULT_CHAT_ENDPOINT = 'https://chat.openape.ai'

interface Room {
  id: string
  name: string
  kind: 'channel' | 'dm'
  /** Only present on GET /api/rooms (caller's role). */
  role?: 'admin' | 'member'
}

interface Member {
  userEmail: string
  role: 'admin' | 'member'
  joinedAt: number
}

function chatEndpoint(): string {
  return (process.env.APE_CHAT_ENDPOINT ?? DEFAULT_CHAT_ENDPOINT).replace(/\/$/, '')
}

async function chatFetch<T>(
  bearer: string,
  path: string,
  init?: { method?: string, body?: unknown },
): Promise<T> {
  const url = `${chatEndpoint()}${path}`
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`chat.openape.ai ${init?.method ?? 'GET'} ${path} → ${res.status}: ${detail.slice(0, 200)}`)
  }
  return await res.json() as T
}

async function listRooms(bearer: string): Promise<Room[]> {
  return chatFetch<Room[]>(bearer, '/api/rooms')
}

async function listMembers(bearer: string, roomId: string): Promise<Member[]> {
  return chatFetch<Member[]>(bearer, `/api/rooms/${encodeURIComponent(roomId)}/members`)
}

async function findExistingDm(bearer: string, callerEmail: string, peerEmail: string): Promise<Room | null> {
  // Walk the caller's rooms, filter to DMs, and pick the one whose member
  // set is exactly {caller, peer}. Server-side this would be a single
  // query — keeping it client-side until the chat-app exposes a
  // /api/dms-with/{email} endpoint.
  const rooms = await listRooms(bearer)
  for (const room of rooms) {
    if (room.kind !== 'dm') continue
    const members = await listMembers(bearer, room.id)
    if (members.length !== 2) continue
    const emails = new Set(members.map(m => m.userEmail.toLowerCase()))
    if (emails.has(callerEmail.toLowerCase()) && emails.has(peerEmail.toLowerCase())) {
      return room
    }
  }
  return null
}

/**
 * Idempotent: ensure a DM room exists between the caller and the agent,
 * with both as members. Used by `apes agents spawn --bridge` so the
 * fresh agent immediately has a 1:1 chat with the spawning user — no
 * room name, no manual invite.
 *
 * Returns the DM room id and whether it was created or reused.
 */
export async function ensureDmWith(opts: {
  callerBearer: string
  callerEmail: string
  peerEmail: string
}): Promise<{ roomId: string, created: boolean }> {
  const existing = await findExistingDm(opts.callerBearer, opts.callerEmail, opts.peerEmail)
  if (existing) return { roomId: existing.id, created: false }

  // Name is informational. The new contacts UI surfaces the peer's email
  // (or display name) directly; this string is only the fallback in
  // legacy room-list views.
  const room = await chatFetch<Room>(opts.callerBearer, '/api/rooms', {
    method: 'POST',
    body: { name: opts.peerEmail, kind: 'dm', members: [opts.peerEmail] },
  })
  return { roomId: room.id, created: true }
}
