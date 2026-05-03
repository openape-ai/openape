import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestContactWithAgent } from '../src/lib/chat-room'

describe('requestContactWithAgent', () => {
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

  it('POSTs /api/contacts with the agent email', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ url, method, body })
      return jsonResponse(201, {
        peerEmail: 'agent-x@id',
        myStatus: 'accepted',
        theirStatus: 'pending',
        connected: false,
        roomId: null,
      })
    }) as typeof fetch

    const view = await requestContactWithAgent({
      callerBearer: 'tok',
      agentEmail: 'agent-x@id',
    })

    expect(view.peerEmail).toBe('agent-x@id')
    expect(view.connected).toBe(false)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'POST',
      body: { email: 'agent-x@id' },
    })
    expect(calls[0]!.url).toMatch(/\/api\/contacts$/)
  })

  it('reports connected:true when both sides already accepted', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(201, {
      peerEmail: 'agent-y@id',
      myStatus: 'accepted',
      theirStatus: 'accepted',
      connected: true,
      roomId: 'room-abc',
    })) as typeof fetch

    const view = await requestContactWithAgent({
      callerBearer: 'tok',
      agentEmail: 'agent-y@id',
    })
    expect(view.connected).toBe(true)
    expect(view.roomId).toBe('room-abc')
  })

  it('surfaces server errors with status code', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(401, { error: 'nope' })) as typeof fetch
    await expect(requestContactWithAgent({
      callerBearer: 'bad',
      agentEmail: 'a@b',
    })).rejects.toThrow(/401/)
  })
})
