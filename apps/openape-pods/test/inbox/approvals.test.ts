import { afterEach, expect, it, vi } from 'vitest'
import { countPendingGrants, pendingApprovals } from '../../src/main/inbox/approvals'
import { readJSON } from '../../src/main/connections/http'

const grant = (id: string, requester: string, status = 'pending', batch?: string, waits = 2000) => ({ id, status, request: { requester, waits_until: waits, ...(batch ? { batch: { id: batch } } : {}) } })

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('counts what apes grants inbox lists, one approval per batch', () => {
  const page = {
    data: [
      grant('g1', 'pod-a@pods.openape.ai', 'pending', 'b1'),
      grant('g2', 'pod-a@pods.openape.ai', 'pending', 'b1'),
      grant('g3', 'pod-b@pods.openape.ai', 'pending', 'b1'),
      grant('g4', 'agent@id.openape.ai'),
      grant('g5', 'Owner@Example.com'),
      grant('g6', 'agent@id.openape.ai', 'approved'),
      grant('g7', 'pod-c@pods.openape.ai', 'pending', 'old', 900),
    ],
  }
  // One batch per requester, one single grant; the owner's own request, decided grants and requests nobody waits for do not count.
  expect(countPendingGrants(page, 'owner@example.com', 1000)).toBe(3)
  expect(() => countPendingGrants({}, 'owner@example.com')).toThrow('Invalid IdP grant listing')
})

const owner = { issuer: 'https://id.example.com', email: 'owner@example.com' }
const login = () => ({ signedIn: vi.fn(() => true), token: vi.fn(async () => ({ issuer: owner.issuer, accessToken: 'synthetic-token' })) })

it('counts a large grant listing without raising the default connection response limit', async () => {
  const body = JSON.stringify({ data: Array.from({ length: 31 }, (_, index) => ({ id: `grant-${index}`, status: 'pending', requester: 'pod@example.com', request: { command: ['synthetic-command', 'x'.repeat(5000)] } })) })
  expect(Buffer.byteLength(body)).toBeGreaterThan(128 * 1024)
  await expect(readJSON(new Response(body))).rejects.toThrow('Connection response exceeds its limit')
  const fetch = vi.fn(async () => new Response(body))
  vi.stubGlobal('fetch', fetch)
  const count = pendingApprovals(login, async () => owner)
  const signal = new AbortController().signal
  await expect(count(signal)).resolves.toEqual({ pending: 31, url: `${owner.issuer}/grants` })
  await expect(count(signal)).resolves.toEqual({ pending: 31, url: `${owner.issuer}/grants` })
  expect(fetch).toHaveBeenCalledExactlyOnceWith(`${owner.issuer}/api/grants?status=pending&limit=100`, expect.objectContaining({ redirect: 'error', headers: { Authorization: 'Bearer synthetic-token' } }))
})

it('enforces an explicit byte budget across streamed UTF-8 chunks', async () => {
  const value = { text: 'ä'.repeat(30) }
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const response = () => new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 12)); controller.enqueue(bytes.slice(12)); controller.close() } }))
  await expect(readJSON(response(), bytes.length)).resolves.toEqual(value)
  await expect(readJSON(response(), bytes.length - 1)).rejects.toThrow('Connection response exceeds its limit')
})

it.each(['oversized', 'http-error', 'timeout'] as const)('keeps a %s listing unknown and caches that outcome', async (failure) => {
  const fetch = vi.fn(async () => {
    if (failure === 'timeout') throw new DOMException('The operation timed out', 'TimeoutError')
    return failure === 'http-error' ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ data: [], padding: 'x'.repeat(1024 * 1024) }))
  })
  vi.stubGlobal('fetch', fetch)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const count = pendingApprovals(login, async () => owner)
  const signal = new AbortController().signal
  await expect(count(signal)).resolves.toEqual({ pending: null, url: `${owner.issuer}/grants` })
  await expect(count(signal)).resolves.toEqual({ pending: null, url: `${owner.issuer}/grants` })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('does not read grants without the matching owner login', async () => {
  const current = login(); current.signedIn.mockReturnValue(false)
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const count = pendingApprovals(() => current, async () => owner)
  await expect(count(new AbortController().signal)).resolves.toEqual({ pending: null, url: `${owner.issuer}/grants` })
  expect(current.token).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})
