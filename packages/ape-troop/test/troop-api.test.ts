import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuthorizedBearer, NotLoggedInError } from '@openape/cli-auth'
import { CliError } from '../src/errors'
import { resolveTroopUrl, TroopApi } from '../src/troop-api'

vi.mock('@openape/cli-auth', () => ({
  getAuthorizedBearer: vi.fn(),
  NotLoggedInError: class NotLoggedInError extends Error {},
}))

const ORIGINAL = process.env.OPENAPE_TROOP_URL
const getAuthorizedBearerMock = vi.mocked(getAuthorizedBearer)
const fetchMock = vi.fn()

beforeEach(() => {
  getAuthorizedBearerMock.mockReset()
  getAuthorizedBearerMock.mockResolvedValue('Bearer test-token')
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
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
  it('derives aud from the host', () => {
    const api = new TroopApi('https://troop.openape.ai')
    expect(api.aud).toBe('troop.openape.ai')
    expect(api.url).toBe('https://troop.openape.ai')
  })

  it('lists nests', async () => {
    const api = new TroopApi('https://troop.example')
    const nests = [{ host_id: 'nest-1', display_name: 'Nest 1', pod_uuid: null, status: 'active', created_at: 1, last_seen_at: 2 }]
    fetchMock.mockResolvedValueOnce(jsonResponse(nests))

    await expect(api.listNests()).resolves.toEqual(nests)
    expect(getAuthorizedBearerMock).toHaveBeenCalledWith({ endpoint: 'https://troop.example', aud: 'troop.example' })
    expect(fetchMock).toHaveBeenCalledWith('https://troop.example/api/nests', {
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('binds a nest with an optional pod uuid', async () => {
    const api = new TroopApi('https://troop.example')
    const result = { host_id: 'nest-1', display_name: 'Nest 1', reused: false }
    fetchMock.mockResolvedValueOnce(jsonResponse(result))

    await expect(api.bindNest('Nest 1', 'pod-1')).resolves.toEqual(result)
    expect(fetchMock).toHaveBeenCalledWith('https://troop.example/api/nests/bind', {
      method: 'POST',
      body: JSON.stringify({ display_name: 'Nest 1', pod_uuid: 'pod-1' }),
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('removes a nest', async () => {
    const api = new TroopApi('https://troop.example')
    const result = { host_id: 'nest/1', status: 'revoked' }
    fetchMock.mockResolvedValueOnce(jsonResponse(result))

    await expect(api.removeNest('nest/1')).resolves.toEqual(result)
    expect(fetchMock).toHaveBeenCalledWith('https://troop.example/api/nests/nest%2F1', {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('lists agents', async () => {
    const api = new TroopApi('https://troop.example')
    const agents = [{ email: 'agent@example.com', agentName: 'writer', hostId: 'nest-1', hostname: 'nest', lastSeenAt: 1, createdAt: 2, taskCount: 3, lastRunStatus: 'ok', lastRunAt: 4 }]
    fetchMock.mockResolvedValueOnce(jsonResponse(agents))

    await expect(api.listAgents()).resolves.toEqual(agents)
    expect(fetchMock).toHaveBeenCalledWith('https://troop.example/api/agents', {
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('spawns an agent with optional host and system prompt', async () => {
    const api = new TroopApi('https://troop.example')
    const result = { intent_id: 'intent-1', host_id: 'nest-1', hostname: 'nest' }
    fetchMock.mockResolvedValueOnce(jsonResponse(result))

    await expect(api.spawnAgent({ name: 'writer', hostId: 'nest-1', systemPrompt: 'be concise' })).resolves.toEqual(result)
    expect(fetchMock).toHaveBeenCalledWith('https://troop.example/api/agents/spawn-intent', {
      method: 'POST',
      body: JSON.stringify({ name: 'writer', host_id: 'nest-1', system_prompt: 'be concise' }),
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('polls spawn intent status', async () => {
    const api = new TroopApi('https://troop.example')
    const result = { pending: false, ok: true, agent_email: 'agent@example.com' }
    fetchMock.mockResolvedValueOnce(jsonResponse(result))

    await expect(api.pollSpawn('intent/1')).resolves.toEqual(result)
    expect(fetchMock).toHaveBeenCalledWith('https://troop.example/api/agents/spawn-intent/intent%2F1', {
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('creates a destroy intent', async () => {
    const api = new TroopApi('https://troop.example')
    const result = { intent_id: 'intent-2', host_id: 'nest-1', hostname: 'nest' }
    fetchMock.mockResolvedValueOnce(jsonResponse(result))

    await expect(api.destroyAgent({ name: 'writer', hostId: 'nest-1' })).resolves.toEqual(result)
    expect(fetchMock).toHaveBeenCalledWith('https://troop.example/api/agents/destroy-intent', {
      method: 'POST',
      body: JSON.stringify({ name: 'writer', host_id: 'nest-1' }),
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('polls destroy intent status', async () => {
    const api = new TroopApi('https://troop.example')
    const result = { pending: false, ok: true }
    fetchMock.mockResolvedValueOnce(jsonResponse(result))

    await expect(api.pollDestroy('intent/2')).resolves.toEqual(result)
    expect(fetchMock).toHaveBeenCalledWith('https://troop.example/api/agents/destroy-intent/intent%2F2', {
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('maps NotLoggedInError to a CliError', async () => {
    const api = new TroopApi('https://troop.example')
    getAuthorizedBearerMock.mockRejectedValueOnce(new NotLoggedInError('missing login'))

    await expect(api.listNests()).rejects.toMatchObject({
      name: 'CliError',
      message: 'Not authenticated. Run `apes login <email>` first.',
      exitCode: 1,
    })
  })

  it('maps non-ok responses to a CliError with method and path', async () => {
    const api = new TroopApi('https://troop.example')
    fetchMock.mockResolvedValueOnce(errorResponse(403, 'forbidden'))

    await expect(api.destroyAgent({ name: 'writer' })).rejects.toMatchObject({
      name: 'CliError',
      message: 'troop POST /api/agents/destroy-intent failed: 403 forbidden',
      exitCode: 1,
    })
  })

  it('returns undefined for 204 responses', async () => {
    const api = new TroopApi('https://troop.example')
    fetchMock.mockResolvedValueOnce(noContentResponse())

    await expect((api as any).request('/api/nests/nest-1', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('preserves custom headers passed to request', async () => {
    const api = new TroopApi('https://troop.example')
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    await expect((api as any).request('/api/nests', { headers: { 'X-Trace-Id': 'trace-1' } })).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledWith('https://troop.example/api/nests', {
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
        'X-Trace-Id': 'trace-1',
      },
    })
  })
})

describe('CliError', () => {
  it('uses CliError as the name and keeps the default exit code', () => {
    const err = new CliError('boom')
    expect(err.name).toBe('CliError')
    expect(err.exitCode).toBe(1)
    expect(err.message).toBe('boom')
  })

  it('accepts a custom exit code', () => {
    const err = new CliError('boom', 9)
    expect(err.exitCode).toBe(9)
  })
})

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

function errorResponse(status: number, text: string): Response {
  return {
    ok: false,
    status,
    text: vi.fn().mockResolvedValue(text),
  } as unknown as Response
}

function noContentResponse(): Response {
  return {
    ok: true,
    status: 204,
  } as unknown as Response
}
