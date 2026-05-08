import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TRIBE_URL, resolveTribeUrl, TribeClient } from '../src/lib/tribe-client'

describe('resolveTribeUrl', () => {
  const original = process.env.OPENAPE_TRIBE_URL
  afterEach(() => {
    if (original === undefined) delete process.env.OPENAPE_TRIBE_URL
    else process.env.OPENAPE_TRIBE_URL = original
  })

  it('returns the default when nothing is set', () => {
    delete process.env.OPENAPE_TRIBE_URL
    expect(resolveTribeUrl()).toBe(DEFAULT_TRIBE_URL)
  })

  it('honours the env var', () => {
    process.env.OPENAPE_TRIBE_URL = 'https://staging.tribe.openape.ai'
    expect(resolveTribeUrl()).toBe('https://staging.tribe.openape.ai')
  })

  it('explicit override beats the env var', () => {
    process.env.OPENAPE_TRIBE_URL = 'https://staging.tribe.openape.ai'
    expect(resolveTribeUrl('http://localhost:3010')).toBe('http://localhost:3010')
  })

  it('strips trailing slash', () => {
    expect(resolveTribeUrl('http://localhost:3010/')).toBe('http://localhost:3010')
  })
})

describe('TribeClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  it('attaches the agent JWT as a Bearer header', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }))
    const client = new TribeClient('http://localhost:3010', 'test.jwt.value')
    await client.listTasks()
    const [, init] = fetchMock.mock.calls[0]!
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test.jwt.value')
  })

  it('throws with the response body on non-2xx', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }))
    const client = new TribeClient('http://localhost:3010', 'jwt')
    await expect(client.listTasks()).rejects.toThrow(/500.*boom/)
  })

  it('returns undefined for 204 responses', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    const client = new TribeClient('http://localhost:3010', 'jwt')
    const out = await client.finaliseRun('id-1', { status: 'ok', final_message: 'done', step_count: 1 })
    expect(out).toBeUndefined()
  })

  it('sync POSTs the expected body shape', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      agent_email: 'a',
      host_id: 'h',
      first_sync: true,
      last_seen_at: 0,
    }), { status: 200 }))
    const client = new TribeClient('http://localhost:3010', 'jwt')
    await client.sync({
      hostname: 'mac.local',
      hostId: 'AAAA-BBBB',
      ownerEmail: 'patrick@example.com',
      pubkeySsh: 'ssh-ed25519 …',
    })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://localhost:3010/api/agents/me/sync')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      hostname: 'mac.local',
      host_id: 'AAAA-BBBB',
      owner_email: 'patrick@example.com',
      pubkey_ssh: 'ssh-ed25519 …',
    })
  })

  it('startRun maps task_id, finaliseRun PATCHes the run id', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'r-1', started_at: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
    const client = new TribeClient('http://localhost:3010', 'jwt')
    await client.startRun('mail-triage')
    await client.finaliseRun('r-1', { status: 'ok', final_message: null, step_count: 3, trace: { foo: 'bar' } })

    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:3010/api/agents/me/runs')
    expect(fetchMock.mock.calls[1]![0]).toBe('http://localhost:3010/api/agents/me/runs/r-1')
    expect(fetchMock.mock.calls[1]![1].method).toBe('PATCH')
  })
})
