/**
 * Chat-app API wrappers.
 *
 * The generic HTTP machinery (ApiError, request<T>) now lives in
 * @openape/cli-auth via createSpClient. This file exposes the typed
 * per-resource helpers that commands import, keeping all call-sites
 * unchanged.
 */
import { ApiError } from '@openape/cli-auth'
import { _request as request } from './client'
import type { Member, Message, Room, Thread } from './types'

export { ApiError }

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
