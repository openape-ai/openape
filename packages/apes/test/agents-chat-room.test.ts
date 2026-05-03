import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureDmWith } from '../src/lib/chat-room'

describe('ensureDmWith', () => {
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

  it('reuses an existing DM whose member set matches caller + peer', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ url, method, body })
      if (url.endsWith('/api/rooms') && method === 'GET') {
        return jsonResponse(200, [
          { id: 'r-channel', name: 'team', kind: 'channel' },
          { id: 'r-dm', name: 'agent-x@id', kind: 'dm' },
          { id: 'r-other-dm', name: 'someone-else', kind: 'dm' },
        ])
      }
      if (url.includes('/api/rooms/r-dm/members')) {
        return jsonResponse(200, [
          { userEmail: 'PATRICK@hofmann.eco', role: 'admin', joinedAt: 1 },
          { userEmail: 'agent-x@id', role: 'member', joinedAt: 1 },
        ])
      }
      if (url.includes('/api/rooms/r-other-dm/members')) {
        return jsonResponse(200, [
          { userEmail: 'patrick@hofmann.eco', role: 'admin', joinedAt: 1 },
          { userEmail: 'someone@else', role: 'member', joinedAt: 1 },
        ])
      }
      throw new Error(`unexpected ${method} ${url}`)
    }) as typeof fetch

    const out = await ensureDmWith({
      callerBearer: 'tok',
      callerEmail: 'patrick@hofmann.eco',
      peerEmail: 'agent-x@id',
    })

    expect(out).toEqual({ roomId: 'r-dm', created: false })
    // Match must be email-case-insensitive (the server may have stored
    // either case; bridge-side reads should not care).
    expect(calls.find(c => c.method === 'POST' && c.url.endsWith('/api/rooms'))).toBeUndefined()
  })

  it('creates a new DM when none exists with the peer, and adds the peer as a member', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ url, method, body })
      if (url.endsWith('/api/rooms') && method === 'GET') return jsonResponse(200, [])
      if (url.endsWith('/api/rooms') && method === 'POST') {
        // Backend auto-adds the caller; we ask for the peer in `members`.
        return jsonResponse(200, { id: 'r-new', name: 'agent-y@id', kind: 'dm' })
      }
      throw new Error(`unexpected ${method} ${url}`)
    }) as typeof fetch

    const out = await ensureDmWith({
      callerBearer: 'tok',
      callerEmail: 'patrick@hofmann.eco',
      peerEmail: 'agent-y@id',
    })

    expect(out).toEqual({ roomId: 'r-new', created: true })
    const post = calls.find(c => c.method === 'POST')
    expect(post?.body).toEqual({ name: 'agent-y@id', kind: 'dm', members: ['agent-y@id'] })
  })

  it('skips DMs whose member sets contain other emails (no false reuse)', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/rooms')) {
        return jsonResponse(200, [{ id: 'r-3way', name: 'oddly named', kind: 'dm' }])
      }
      if (url.includes('/members')) {
        return jsonResponse(200, [
          { userEmail: 'patrick@hofmann.eco', role: 'admin', joinedAt: 1 },
          { userEmail: 'someone@else', role: 'member', joinedAt: 1 },
          { userEmail: 'third@person', role: 'member', joinedAt: 1 },
        ])
      }
      throw new Error('boom')
    }) as typeof fetch

    // Add a POST handler so the create path is reachable.
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.endsWith('/api/rooms') && method === 'POST') {
        return jsonResponse(200, { id: 'r-fresh', name: 'p@e', kind: 'dm' })
      }
      return originalFetch(input, init)
    }) as typeof fetch

    const out = await ensureDmWith({
      callerBearer: 'tok',
      callerEmail: 'patrick@hofmann.eco',
      peerEmail: 'p@e',
    })
    expect(out.created).toBe(true)
    expect(out.roomId).toBe('r-fresh')
  })

  it('surfaces server-side errors with status code', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(401, { error: 'nope' })) as typeof fetch
    await expect(ensureDmWith({
      callerBearer: 'bad',
      callerEmail: 'a@b',
      peerEmail: 'c@d',
    })).rejects.toThrow(/401/)
  })
})
