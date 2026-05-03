// Helpers for `apes agents spawn --bridge --bridge-room <name>`. Hits
// chat.openape.ai's REST API as the spawning user (uses their IdP bearer)
// to create a room (or find existing) and add the agent as a member.
//
// We deliberately use plain fetch here rather than depending on
// @openape/ape-chat — keeps apes free of a runtime npm dep on the chat
// CLI. The shape mirrors openape-chat's server/api/rooms/* endpoints.

const DEFAULT_CHAT_ENDPOINT = 'https://chat.openape.ai'

interface Room {
  id: string
  name: string
  kind: 'channel' | 'dm'
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

async function findRoomByName(bearer: string, name: string): Promise<Room | null> {
  const rooms = await chatFetch<Room[]>(bearer, '/api/rooms')
  return rooms.find(r => r.name === name) ?? null
}

async function createRoom(bearer: string, name: string): Promise<Room> {
  return chatFetch<Room>(bearer, '/api/rooms', {
    method: 'POST',
    body: { name, kind: 'channel', members: [] },
  })
}

async function addMember(bearer: string, roomId: string, email: string, role: 'member' | 'admin' = 'member'): Promise<void> {
  await chatFetch(bearer, `/api/rooms/${encodeURIComponent(roomId)}/members`, {
    method: 'POST',
    body: { email, role },
  })
}

/**
 * Idempotent: ensure a room with the given name exists and the agent is
 * a member. Returns the room id.
 *
 * - If the room exists, reuse it.
 * - If the room exists and the agent is already a member, no-op on
 *   membership (server returns 200 on duplicate inserts in our schema).
 */
export async function ensureRoomMembership(opts: {
  callerBearer: string
  roomName: string
  agentEmail: string
}): Promise<{ roomId: string, created: boolean }> {
  const existing = await findRoomByName(opts.callerBearer, opts.roomName)
  let room: Room
  let created = false
  if (existing) {
    room = existing
  }
  else {
    room = await createRoom(opts.callerBearer, opts.roomName)
    created = true
  }
  await addMember(opts.callerBearer, room.id, opts.agentEmail)
  return { roomId: room.id, created }
}
