import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuthorizedBearer, NotLoggedInError } from '@openape/cli-auth'
import { CliError } from '../src/errors'
import { resolveTroopUrl, TroopApi } from '../src/troop-api'

vi.mock('@openape/cli-auth', () => ({
  getAuthorizedBearer: vi.fn(),
  NotLoggedInError: class NotLoggedInError extends Error {},
}))

const mockedGetAuthorizedBearer = vi.mocked(getAuthorizedBearer)
const ORIGINAL = process.env.OPENAPE_TROOP_URL
const ORIGINAL_FETCH = globalThis.fetch

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  mockedGetAuthorizedBearer.mockReset()
  mockedGetAuthorizedBearer.mockResolvedValue('Bearer token-123')
  globalThis.fetch = vi.fn()
})

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.OPENAPE_TROOP_URL
  else process.env.OPENAPE_TROOP_URL = ORIGINAL
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  vi.restoreAllMocks()
})

describe('resolveTroopUrl', () => {
  it('defaults to the prod troop URL', () => {
    delete process.env.OPENAPE_TROOP_URL
    expect(resolveTroopUrl()).toBe('https://troop.openape.ai')
  })

  it('honors an explicit override and strips trailing slash', () => {
    expect(resolveTroopUrl('https://staging.troop.example/')).toBe('https://staging.troop.example')
  })

  it('falls back to OPENAPE_TROOP_URL env', () => {
    process.env.OPENAPE_TROOP_URL = 'http://127.0.0.1:9091/'
    expect(resolveTroopUrl()).toBe('http://127.0.0.1:9091')
  })

  it('explicit override wins over env', () => {
    process.env.OPENAPE_TROOP_URL = 'http://env-host:1234'
    expect(resolveTroopUrl('https://explicit.example')).toBe('https://explicit.example')
  })
})

describe('TroopApi', () => {
  it('derives aud from the host', () => {
    const api = new TroopApi('https://troop.openape.ai')
    expect(api.aud).toBe('troop.openape.ai')
    expect(api.url).toBe('https://troop.openape.ai')
  })

  it('sends auth and parses listNests responses', async () => {
    const rows = [{ host_id: 'host-1', display_name: 'Nest 1', pod_uuid: null, status: 'active', created_at: 1, last_seen_at: 2 }]
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(rows))

    const api = new TroopApi('https://troop.openape.ai/')
    await expect(api.listNests()).resolves.toEqual(rows)

    expect(mockedGetAuthorizedBearer).toHaveBeenCalledWith({ endpoint: 'https://troop.openape.ai', aud: 'troop.openape.ai' })
    expect(globalThis.fetch).toHaveBeenCalledWith('https://troop.openape.ai/api/nests', {
      headers: {
        Authorization: 'Bearer token-123',
        'Content-Type': 'application/json',
      },
    })
  })

  it('shapes bindNest requests with optional pod_uuid', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ host_id: 'host-1', display_name: 'Nest 1', reused: false }))
    const api = new TroopApi('https://troop.openape.ai')

    await api.bindNest('Nest 1', 'pod-1')

    expect(globalThis.fetch).toHaveBeenCalledWith('https://troop.openape.ai/api/nests/bind', {
      method: 'POST',
      body: JSON.stringify({ display_name: 'Nest 1', pod_uuid: 'pod-1' }),
      headers: {
        Authorization: 'Bearer token-123',
        'Content-Type': 'application/json',
      },
    })
  })

  it('omits optional pod_uuid when binding a nest', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ host_id: 'host-1', display_name: 'Nest 1', reused: true }))
    const api = new TroopApi('https://troop.openape.ai')

    await api.bindNest('Nest 1')

    expect(globalThis.fetch).toHaveBeenCalledWith('https://troop.openape.ai/api/nests/bind', expect.objectContaining({
      body: JSON.stringify({ display_name: 'Nest 1' }),
    }))
  })

  it('encodes host ids and accepts 204 on removeNest', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 204 }))
    const api = new TroopApi('https://troop.openape.ai')

    await expect(api.removeNest('nest/id with spaces')).resolves.toBeUndefined()
    expect(globalThis.fetch).toHaveBeenCalledWith('https://troop.openape.ai/api/nests/nest%2Fid%20with%20spaces', {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer token-123',
        'Content-Type': 'application/json',
      },
    })
  })

  it('parses listAgents responses', async () => {
    const rows = [{ email: 'a@b.c', agentName: 'qa', hostId: null, hostname: null, lastSeenAt: null, createdAt: 1, taskCount: 0, lastRunStatus: null, lastRunAt: null }]
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(rows))
    const api = new TroopApi('https://troop.openape.ai')

    await expect(api.listAgents()).resolves.toEqual(rows)
  })

  it('shapes spawnAgent requests with all optional fields', async () => {
    const result = { intent_id: 'intent-1', host_id: 'host-1', hostname: 'nest-1' }
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(result))
    const api = new TroopApi('https://troop.openape.ai')

    await expect(api.spawnAgent({ name: 'qa-bot', hostId: 'host-1', systemPrompt: 'be precise' })).resolves.toEqual(result)
    expect(globalThis.fetch).toHaveBeenCalledWith('https://troop.openape.ai/api/agents/spawn-intent', {
      method: 'POST',
      body: JSON.stringify({ name: 'qa-bot', host_id: 'host-1', system_prompt: 'be precise' }),
      headers: {
        Authorization: 'Bearer token-123',
        'Content-Type': 'application/json',
      },
    })
  })

  it('omits optional spawnAgent fields when absent', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ intent_id: 'intent-1', host_id: 'host-1', hostname: 'nest-1' }))
    const api = new TroopApi('https://troop.openape.ai')

    await api.spawnAgent({ name: 'qa-bot' })

    expect(globalThis.fetch).toHaveBeenCalledWith('https://troop.openape.ai/api/agents/spawn-intent', expect.objectContaining({
      body: JSON.stringify({ name: 'qa-bot' }),
    }))
  })

  it('encodes spawn intent ids when polling', async () => {
    const poll = { pending: false, ok: true, agent_email: 'qa@id.openape.ai' }
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(poll))
    const api = new TroopApi('https://troop.openape.ai')

    await expect(api.pollSpawn('intent/1 with spaces')).resolves.toEqual(poll)
    expect(globalThis.fetch).toHaveBeenCalledWith('https://troop.openape.ai/api/agents/spawn-intent/intent%2F1%20with%20spaces', {
      headers: {
        Authorization: 'Bearer token-123',
        'Content-Type': 'application/json',
      },
    })
  })

  it('shapes destroyAgent requests with optional hostId', async () => {
    const result = { intent_id: 'intent-2', host_id: 'host-2', hostname: 'nest-2' }
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(result))
    const api = new TroopApi('https://troop.openape.ai')

    await expect(api.destroyAgent({ name: 'qa-bot', hostId: 'host-2' })).resolves.toEqual(result)
    expect(globalThis.fetch).toHaveBeenCalledWith('https://troop.openape.ai/api/agents/destroy-intent', {
      method: 'POST',
      body: JSON.stringify({ name: 'qa-bot', host_id: 'host-2' }),
      headers: {
        Authorization: 'Bearer token-123',
        'Content-Type': 'application/json',
      },
    })
  })

  it('encodes destroy intent ids when polling', async () => {
    const poll = { pending: false, ok: true }
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(poll))
    const api = new TroopApi('https://troop.openape.ai')

    await expect(api.pollDestroy('intent/2 with spaces')).resolves.toEqual(poll)
    expect(globalThis.fetch).toHaveBeenCalledWith('https://troop.openape.ai/api/agents/destroy-intent/intent%2F2%20with%20spaces', {
      headers: {
        Authorization: 'Bearer token-123',
        'Content-Type': 'application/json',
      },
    })
  })

  it('maps NotLoggedInError to a CliError', async () => {
    mockedGetAuthorizedBearer.mockRejectedValue(new NotLoggedInError('no login'))
    const api = new TroopApi('https://troop.openape.ai')

    await expect(api.listNests()).rejects.toMatchObject({
      name: 'CliError',
      message: 'Not authenticated. Run `apes login <email>` first.',
      exitCode: 1,
    })
  })

  it('maps non-ok troop responses to CliError with method, path and status text', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response('bad wolf', { status: 418 }))
    const api = new TroopApi('https://troop.openape.ai')

    await expect(api.destroyAgent({ name: 'qa-bot' })).rejects.toMatchObject({
      name: 'CliError',
      message: 'troop POST /api/agents/destroy-intent failed: 418 bad wolf',
      exitCode: 1,
    })
  })
})

describe('CliError', () => {
  it('defaults exitCode to 1', () => {
    const err = new CliError('boom')
    expect(err.name).toBe('CliError')
    expect(err.message).toBe('boom')
    expect(err.exitCode).toBe(1)
  })

  it('preserves an explicit exitCode', () => {
    const err = new CliError('boom', 7)
    expect(err.exitCode).toBe(7)
  })
})
