import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotLoggedInError } from '@openape/cli-auth'
import { CliError } from '../src/errors'
import { resolveTroopUrl, TroopApi } from '../src/troop-api'

vi.mock('@openape/cli-auth', () => ({
  getAuthorizedBearer: vi.fn(),
  NotLoggedInError: class NotLoggedInError extends Error {},
}))

const ORIGINAL = process.env.OPENAPE_TROOP_URL

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.OPENAPE_TROOP_URL
  else process.env.OPENAPE_TROOP_URL = ORIGINAL
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

  it('lists nests with auth headers', async () => {
    const { getAuthorizedBearer } = await import('@openape/cli-auth')
    vi.mocked(getAuthorizedBearer).mockResolvedValue('Bearer token')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([{ host_id: 'h1' }]), { status: 200 }))

    const api = new TroopApi('https://troop.openape.ai')
    await expect(api.listNests()).resolves.toEqual([{ host_id: 'h1' }])
    expect(getAuthorizedBearer).toHaveBeenCalledWith({ endpoint: 'https://troop.openape.ai', aud: 'troop.openape.ai' })
    expect(fetchMock).toHaveBeenCalledWith('https://troop.openape.ai/api/nests', {
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('binds a nest without pod uuid when omitted', async () => {
    const { getAuthorizedBearer } = await import('@openape/cli-auth')
    vi.mocked(getAuthorizedBearer).mockResolvedValue('Bearer token')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ host_id: 'h1', display_name: 'nest', reused: false }), { status: 200 }))

    const api = new TroopApi('https://troop.openape.ai')
    await expect(api.bindNest('nest')).resolves.toEqual({ host_id: 'h1', display_name: 'nest', reused: false })
    expect(fetchMock).toHaveBeenCalledWith('https://troop.openape.ai/api/nests/bind', {
      method: 'POST',
      body: JSON.stringify({ display_name: 'nest' }),
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('binds a nest with pod uuid when provided', async () => {
    const { getAuthorizedBearer } = await import('@openape/cli-auth')
    vi.mocked(getAuthorizedBearer).mockResolvedValue('Bearer token')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ host_id: 'h1', display_name: 'nest', reused: true }), { status: 200 }))

    const api = new TroopApi('https://troop.openape.ai')
    await api.bindNest('nest', 'pod-1')
    expect(fetchMock).toHaveBeenCalledWith('https://troop.openape.ai/api/nests/bind', {
      method: 'POST',
      body: JSON.stringify({ display_name: 'nest', pod_uuid: 'pod-1' }),
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('removes a nest with encoded host id', async () => {
    const { getAuthorizedBearer } = await import('@openape/cli-auth')
    vi.mocked(getAuthorizedBearer).mockResolvedValue('Bearer token')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ host_id: 'nest/a b', status: 'revoked' }), { status: 200 }))

    const api = new TroopApi('https://troop.openape.ai')
    await expect(api.removeNest('nest/a b')).resolves.toEqual({ host_id: 'nest/a b', status: 'revoked' })
    expect(fetchMock).toHaveBeenCalledWith('https://troop.openape.ai/api/nests/nest%2Fa%20b', {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('lists agents', async () => {
    const { getAuthorizedBearer } = await import('@openape/cli-auth')
    vi.mocked(getAuthorizedBearer).mockResolvedValue('Bearer token')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([{ email: 'a@example.com' }]), { status: 200 }))

    const api = new TroopApi('https://troop.openape.ai')
    await expect(api.listAgents()).resolves.toEqual([{ email: 'a@example.com' }])
  })

  it('spawns an agent with optional fields', async () => {
    const { getAuthorizedBearer } = await import('@openape/cli-auth')
    vi.mocked(getAuthorizedBearer).mockResolvedValue('Bearer token')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ intent_id: 'i1', host_id: 'h1', hostname: 'nest-1' }), { status: 200 }))

    const api = new TroopApi('https://troop.openape.ai')
    await expect(api.spawnAgent({ name: 'scribe', hostId: 'h1', systemPrompt: 'hi' })).resolves.toEqual({ intent_id: 'i1', host_id: 'h1', hostname: 'nest-1' })
    expect(fetchMock).toHaveBeenCalledWith('https://troop.openape.ai/api/agents/spawn-intent', {
      method: 'POST',
      body: JSON.stringify({ name: 'scribe', host_id: 'h1', system_prompt: 'hi' }),
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('spawns an agent without optional fields', async () => {
    const { getAuthorizedBearer } = await import('@openape/cli-auth')
    vi.mocked(getAuthorizedBearer).mockResolvedValue('Bearer token')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ intent_id: 'i1', host_id: 'h1', hostname: 'nest-1' }), { status: 200 }))

    const api = new TroopApi('https://troop.openape.ai')
    await api.spawnAgent({ name: 'scribe' })
    expect(fetchMock).toHaveBeenCalledWith('https://troop.openape.ai/api/agents/spawn-intent', {
      method: 'POST',
      body: JSON.stringify({ name: 'scribe' }),
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('polls spawn status with encoded intent id', async () => {
    const { getAuthorizedBearer } = await import('@openape/cli-auth')
    vi.mocked(getAuthorizedBearer).mockResolvedValue('Bearer token')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ pending: false, ok: true, agent_email: 'scribe@example.com' }), { status: 200 }))

    const api = new TroopApi('https://troop.openape.ai')
    await expect(api.pollSpawn('intent/1 ok')).resolves.toEqual({ pending: false, ok: true, agent_email: 'scribe@example.com' })
    expect(fetchMock).toHaveBeenCalledWith('https://troop.openape.ai/api/agents/spawn-intent/intent%2F1%20ok', {
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('starts destroy intent with optional host id', async () => {
    const { getAuthorizedBearer } = await import('@openape/cli-auth')
    vi.mocked(getAuthorizedBearer).mockResolvedValue('Bearer token')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ intent_id: 'd1', host_id: 'h1', hostname: 'nest-1' }), { status: 200 }))

    const api = new TroopApi('https://troop.openape.ai')
    await expect(api.destroyAgent({ name: 'scribe', hostId: 'h1' })).resolves.toEqual({ intent_id: 'd1', host_id: 'h1', hostname: 'nest-1' })
    expect(fetchMock).toHaveBeenCalledWith('https://troop.openape.ai/api/agents/destroy-intent', {
      method: 'POST',
      body: JSON.stringify({ name: 'scribe', host_id: 'h1' }),
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
    })
  })

  it('polls destroy status', async () => {
    const { getAuthorizedBearer } = await import('@openape/cli-auth')
    vi.mocked(getAuthorizedBearer).mockResolvedValue('Bearer token')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ pending: false, ok: true }), { status: 200 }))

    const api = new TroopApi('https://troop.openape.ai')
    await expect(api.pollDestroy('intent-2')).resolves.toEqual({ pending: false, ok: true })
  })

  it('maps not logged in auth errors to CliError', async () => {
    const { getAuthorizedBearer } = await import('@openape/cli-auth')
    vi.mocked(getAuthorizedBearer).mockRejectedValue(new NotLoggedInError())

    const api = new TroopApi('https://troop.openape.ai')
    await expect(api.listNests()).rejects.toMatchObject({
      name: 'CliError',
      message: 'Not authenticated. Run `apes login <email>` first.',
      exitCode: 1,
    })
  })

  it('preserves unexpected auth errors', async () => {
    const { getAuthorizedBearer } = await import('@openape/cli-auth')
    const error = new Error('boom')
    vi.mocked(getAuthorizedBearer).mockRejectedValue(error)

    const api = new TroopApi('https://troop.openape.ai')
    await expect(api.listNests()).rejects.toBe(error)
  })

  it('maps non-ok responses to CliError with method and body', async () => {
    const { getAuthorizedBearer } = await import('@openape/cli-auth')
    vi.mocked(getAuthorizedBearer).mockResolvedValue('Bearer token')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad request', { status: 400 }))

    const api = new TroopApi('https://troop.openape.ai')
    await expect(api.bindNest('nest')).rejects.toMatchObject({
      name: 'CliError',
      message: 'troop POST /api/nests/bind failed: 400 bad request',
      exitCode: 1,
    })
  })

  it('uses GET in error messages when method is omitted', async () => {
    const { getAuthorizedBearer } = await import('@openape/cli-auth')
    vi.mocked(getAuthorizedBearer).mockResolvedValue('Bearer token')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('missing', { status: 404 }))

    const api = new TroopApi('https://troop.openape.ai')
    await expect(api.listAgents()).rejects.toMatchObject({
      name: 'CliError',
      message: 'troop GET /api/agents failed: 404 missing',
      exitCode: 1,
    })
  })

  it('returns undefined for 204 responses', async () => {
    const { getAuthorizedBearer } = await import('@openape/cli-auth')
    vi.mocked(getAuthorizedBearer).mockResolvedValue('Bearer token')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))

    const api = new TroopApi('https://troop.openape.ai')
    await expect(api.removeNest('h1')).resolves.toBeUndefined()
  })
})

describe('CliError', () => {
  it('defaults exitCode to 1', () => {
    const error = new CliError('nope')
    expect(error.name).toBe('CliError')
    expect(error.message).toBe('nope')
    expect(error.exitCode).toBe(1)
  })

  it('accepts a custom exitCode', () => {
    expect(new CliError('nope', 7).exitCode).toBe(7)
  })
})
