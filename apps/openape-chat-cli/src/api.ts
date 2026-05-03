import { ofetch } from 'ofetch'
import { getChatBearer } from './auth'
import { getEndpoint } from './config'
import type { Member, Message, Room } from './types'

export class ApiError extends Error {
  constructor(
    public status: number,
    public title: string,
    public detail?: string,
  ) {
    super(detail ? `${title}: ${detail}` : title)
    this.name = 'ApiError'
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | undefined>
  endpoint?: string
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const endpoint = getEndpoint(opts.endpoint)
  const url = `${endpoint}${path}`
  const headers: Record<string, string> = {
    Authorization: await getChatBearer(),
  }
  try {
    return await ofetch<T>(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body as Record<string, unknown> | undefined,
      query: opts.query as Record<string, string | number> | undefined,
    })
  }
  catch (err: unknown) {
    const status = (err as { status?: number, statusCode?: number }).status
      ?? (err as { statusCode?: number }).statusCode
      ?? 0
    const data = (err as { data?: { title?: string, statusMessage?: string, detail?: string, message?: string } }).data
    const title = data?.title ?? data?.statusMessage ?? data?.message ?? `Request failed (HTTP ${status})`
    throw new ApiError(status, title, data?.detail)
  }
}

export function listRooms(opts?: { endpoint?: string }): Promise<Room[]> {
  return request<Room[]>('/api/rooms', { endpoint: opts?.endpoint })
}

export function createRoom(input: {
  name: string
  kind: 'channel' | 'dm'
  members?: string[]
}, opts?: { endpoint?: string }): Promise<Room> {
  return request<Room>('/api/rooms', {
    method: 'POST',
    body: input,
    endpoint: opts?.endpoint,
  })
}

export function getRoom(id: string, opts?: { endpoint?: string }): Promise<Room> {
  return request<Room>(`/api/rooms/${encodeURIComponent(id)}`, { endpoint: opts?.endpoint })
}

export function listMessages(
  roomId: string,
  query?: { limit?: number, before?: number },
  opts?: { endpoint?: string },
): Promise<Message[]> {
  return request<Message[]>(`/api/rooms/${encodeURIComponent(roomId)}/messages`, {
    query: { limit: query?.limit, before: query?.before },
    endpoint: opts?.endpoint,
  })
}

export function sendMessage(
  roomId: string,
  body: { body: string, reply_to?: string },
  opts?: { endpoint?: string },
): Promise<Message> {
  return request<Message>(`/api/rooms/${encodeURIComponent(roomId)}/messages`, {
    method: 'POST',
    body,
    endpoint: opts?.endpoint,
  })
}

export function listMembers(roomId: string, opts?: { endpoint?: string }): Promise<Member[]> {
  return request<Member[]>(`/api/rooms/${encodeURIComponent(roomId)}/members`, {
    endpoint: opts?.endpoint,
  })
}

export function addMember(
  roomId: string,
  body: { email: string, role?: 'member' | 'admin' },
  opts?: { endpoint?: string },
): Promise<Member> {
  return request<Member>(`/api/rooms/${encodeURIComponent(roomId)}/members`, {
    method: 'POST',
    body,
    endpoint: opts?.endpoint,
  })
}

export function removeMember(
  roomId: string,
  email: string,
  opts?: { endpoint?: string },
): Promise<{ ok: true }> {
  return request<{ ok: true }>(
    `/api/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(email)}`,
    { method: 'DELETE', endpoint: opts?.endpoint },
  )
}

// Exported for new command modules (contacts.ts) that POST/DELETE
// arbitrary chat-app paths without a dedicated wrapper.
export { request as _request }
