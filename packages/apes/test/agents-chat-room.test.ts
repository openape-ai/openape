import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureRoomMembership } from '../src/lib/chat-room'

describe('ensureRoomMembership', () => {
  const realFetch = globalThis.fetch
  const calls: Array<{ url: string, method: string, body?: unknown }> = []

  beforeEach(() => {
    calls.length = 0
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  it('reuses an existing room with the same name (no create call)', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const bodyTxt = init?.body
      calls.push({ url, method, body: bodyTxt ? JSON.parse(String(bodyTxt)) : undefined })
      if (url.endsWith('/api/rooms') && method === 'GET') {
        return jsonResponse(200, [{ id: 'room-1', name: 'demo', kind: 'channel' }])
      }
      if (url.includes('/api/rooms/room-1/members') && method === 'POST') {
        return jsonResponse(200, { userEmail: 'agent-x@id', role: 'member', joinedAt: 1 })
      }
      throw new Error(`unexpected fetch ${method} ${url}`)
    }) as typeof fetch

    const out = await ensureRoomMembership({
      callerBearer: 'tok',
      roomName: 'demo',
      agentEmail: 'agent-x@id',
    })
    expect(out).toEqual({ roomId: 'room-1', created: false })
    expect(calls.map(c => `${c.method} ${c.url.replace(/^https?:\/\/[^/]+/, '')}`)).toEqual([
      'GET /api/rooms',
      'POST /api/rooms/room-1/members',
    ])
  })

  it('creates the room when not found, then adds the agent', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const bodyTxt = init?.body
      calls.push({ url, method, body: bodyTxt ? JSON.parse(String(bodyTxt)) : undefined })
      if (url.endsWith('/api/rooms') && method === 'GET') {
        return jsonResponse(200, [])
      }
      if (url.endsWith('/api/rooms') && method === 'POST') {
        return jsonResponse(200, { id: 'room-new', name: 'fresh', kind: 'channel' })
      }
      if (url.includes('/api/rooms/room-new/members') && method === 'POST') {
        return jsonResponse(200, { userEmail: 'agent-y@id', role: 'member', joinedAt: 1 })
      }
      throw new Error(`unexpected fetch ${method} ${url}`)
    }) as typeof fetch

    const out = await ensureRoomMembership({
      callerBearer: 'tok',
      roomName: 'fresh',
      agentEmail: 'agent-y@id',
    })
    expect(out).toEqual({ roomId: 'room-new', created: true })
    expect(calls).toHaveLength(3)
    expect(calls[1]!.body).toEqual({ name: 'fresh', kind: 'channel', members: [] })
    expect(calls[2]!.body).toEqual({ email: 'agent-y@id', role: 'member' })
  })

  it('surfaces server-side errors with status code', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(401, { error: 'nope' })) as typeof fetch
    await expect(ensureRoomMembership({
      callerBearer: 'bad',
      roomName: 'x',
      agentEmail: 'a@b',
    })).rejects.toThrow(/401/)
  })
})
