import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotLoggedInError } from '@openape/cli-auth'
import { CliError } from '../src/errors'
import { resolveTroopUrl, TroopApi } from '../src/troop-api'

const ORIGINAL = process.env.OPENAPE_TROOP_URL

const { getAuthorizedBearerMock } = vi.hoisted(() => ({
  getAuthorizedBearerMock: vi.fn(async () => 'Bearer test-token'),
}))

vi.mock('@openape/cli-auth', async () => {
  const actual = await vi.importActual<typeof import('@openape/cli-auth')>('@openape/cli-auth')
  return {
    ...actual,
    getAuthorizedBearer: getAuthorizedBearerMock,
  }
})

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.OPENAPE_TROOP_URL
  else process.env.OPENAPE_TROOP_URL = ORIGINAL
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
  const fetchMock = vi.fn()

  beforeEach(() => {
    getAuthorizedBearerMock.mockReset()
    getAuthorizedBearerMock.mockResolvedValue('Bearer test-token')
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('derives aud from the host', () => {
    const api = new TroopApi('https://troop.openape.ai')
    expect(api.aud).toBe('troop.openape.ai')
    expect(api.url).toBe('https://troop.openape.ai')
  })

  it('maps NotLoggedInError to a CliError', async () => {
    const api = new TroopApi('https://troop.openape.ai')
    getAuthorizedBearerMock.mockRejectedValueOnce(new NotLoggedInError())

    await expect(api.listNests()).rejects.toMatchObject({
      name: 'CliError',
      message: 'Not authenticated. Run `apes login <email>` first.',
      exitCode: 1,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes through non-auth helper errors', async () => {
    const api = new TroopApi('https://troop.openape.ai')
    const err = new Error('boom')
    getAuthorizedBearerMock.mockRejectedValueOnce(err)

    await expect(api.listNests()).rejects.toBe(err)
  })

  it('lists nests', async () => {
    const api = new TroopApi('https://troop.openape.ai')
    const payload = [{ host_id: 'h1', display_name: 'Nest 1', pod_uuid: null, status: 'active', created_at: 1, last_seen_at: 2 }]
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))

    await expect(api.listNests()).resolves.toEqual(payload)
    expect(getAuthorizedBearerMock).toHaveBeenCalledWith({ endpoint: 'https://troop.openape.ai', aud: 'troop.openape.ai' })
    expect(fetchMock).toHaveBeenCalledWith('https://troop.openape.ai/api/nests', {
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('binds a nest with an optional pod UUID', async () => {
    const api = new TroopApi('https://troop.openape.ai')
    const payload = { host_id: 'h1', display_name: 'Desk Mac', reused: false }
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))

    await expect(api.bindNest('Desk Mac', 'pod-123')).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith('https://troop.openape.ai/api/nests/bind', {
      method: 'POST',
      body: JSON.stringify({ display_name: 'Desk Mac', pod_uuid: 'pod-123' }),
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('removes a nest and handles 204 responses', async () => {
    const api = new TroopApi('https://troop.openape.ai')
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(api.removeNest('host/1')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('https://troop.openape.ai/api/nests/host%2F1', {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('lists agents', async () => {
    const api = new TroopApi('https://troop.openape.ai')
    const payload = [{ email: 'agent@example.com', agentName: 'scribe', hostId: 'h1', hostname: 'host', lastSeenAt: 3, createdAt: 1, taskCount: 2, lastRunStatus: 'ok', lastRunAt: 4 }]
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))

    await expect(api.listAgents()).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith('https://troop.openape.ai/api/agents', {
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('spawns an agent with optional fields', async () => {
    const api = new TroopApi('https://troop.openape.ai')
    const payload = { intent_id: 'i1', host_id: 'h1', hostname: 'host' }
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))

    await expect(api.spawnAgent({ name: 'scribe', hostId: 'h1', systemPrompt: 'be concise' })).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith('https://troop.openape.ai/api/agents/spawn-intent', {
      method: 'POST',
      body: JSON.stringify({ name: 'scribe', host_id: 'h1', system_prompt: 'be concise' }),
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('polls spawn status', async () => {
    const api = new TroopApi('https://troop.openape.ai')
    const payload = { pending: false, ok: true, agent_email: 'agent@example.com' }
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))

    await expect(api.pollSpawn('intent/1')).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith('https://troop.openape.ai/api/agents/spawn-intent/intent%2F1', {
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('starts agent destroy intent', async () => {
    const api = new TroopApi('https://troop.openape.ai')
    const payload = { intent_id: 'i2', host_id: 'h2', hostname: 'host-2' }
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))

    await expect(api.destroyAgent({ name: 'scribe', hostId: 'h2' })).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith('https://troop.openape.ai/api/agents/destroy-intent', {
      method: 'POST',
      body: JSON.stringify({ name: 'scribe', host_id: 'h2' }),
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('polls destroy status', async () => {
    const api = new TroopApi('https://troop.openape.ai')
    const payload = { pending: false, ok: true }
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))

    await expect(api.pollDestroy('intent/2')).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith('https://troop.openape.ai/api/agents/destroy-intent/intent%2F2', {
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('maps non-ok responses to CliError with status text body', async () => {
    const api = new TroopApi('https://troop.openape.ai')
    fetchMock.mockResolvedValueOnce(new Response('denied', { status: 403 }))

    await expect(api.listAgents()).rejects.toEqual(new CliError('troop GET /api/agents failed: 403 denied'))
  })
})
