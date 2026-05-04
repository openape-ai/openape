import { ofetch } from 'ofetch'
import { getChatBearer } from './auth'
import { getEndpoint } from './config'
import type { Member, Message, Room, Thread } from './types'

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

export function getRoom(id: string, opts?: { endpoint?: string }): Promise<Room> {
  return request<Room>(`/api/rooms/${encodeURIComponent(id)}`, { endpoint: opts?.endpoint })
}

export function listMessages(
  roomId: string,
  query?: { limit?: number, before?: number, threadId?: string },
  opts?: { endpoint?: string },
): Promise<Message[]> {
  return request<Message[]>(`/api/rooms/${encodeURIComponent(roomId)}/messages`, {
    query: { limit: query?.limit, before: query?.before, thread_id: query?.threadId },
    endpoint: opts?.endpoint,
  })
}

export function sendMessage(
  roomId: string,
  body: { body: string, reply_to?: string, thread_id?: string },
  opts?: { endpoint?: string },
): Promise<Message> {
  return request<Message>(`/api/rooms/${encodeURIComponent(roomId)}/messages`, {
    method: 'POST',
    body,
    endpoint: opts?.endpoint,
  })
}

export function listThreads(roomId: string, opts?: { endpoint?: string }): Promise<Thread[]> {
  return request<Thread[]>(`/api/rooms/${encodeURIComponent(roomId)}/threads`, {
    endpoint: opts?.endpoint,
  })
}

export function createThread(
  roomId: string,
  body: { name: string },
  opts?: { endpoint?: string },
): Promise<Thread> {
  return request<Thread>(`/api/rooms/${encodeURIComponent(roomId)}/threads`, {
    method: 'POST',
    body,
    endpoint: opts?.endpoint,
  })
}

export function patchThread(
  threadId: string,
  body: { name?: string, archived?: boolean },
  opts?: { endpoint?: string },
): Promise<Thread> {
  return request<Thread>(`/api/threads/${encodeURIComponent(threadId)}`, {
    method: 'PATCH',
    body,
    endpoint: opts?.endpoint,
  })
}

export function archiveThread(threadId: string, opts?: { endpoint?: string }): Promise<void> {
  return request<void>(`/api/threads/${encodeURIComponent(threadId)}`, {
    method: 'DELETE',
    endpoint: opts?.endpoint,
  })
}

export function listMembers(roomId: string, opts?: { endpoint?: string }): Promise<Member[]> {
  return request<Member[]>(`/api/rooms/${encodeURIComponent(roomId)}/members`, {
    endpoint: opts?.endpoint,
  })
}

// Exported for new command modules (contacts.ts) that POST/DELETE
// arbitrary chat-app paths without a dedicated wrapper.
export { request as _request }
