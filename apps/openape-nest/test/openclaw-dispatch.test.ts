import { describe, expect, it, vi } from 'vitest'
import { resolveOpenclawGatewayKey, runOpenclawTurn } from '../src/lib/agent-runtime-session'

const agent = { name: 'ceo', email: 'ceo@id.openape.ai', home: '/home/ceo' }
const rt = { apiBase: 'https://llms.openape.ai/v1', apiKey: 'k', model: 'LocalCore-Thinking', systemPrompt: 'persona' }
const message = { body: 'status?', roomId: 'room1', threadId: 'thread1', id: 'msg-7' }

describe('runOpenclawTurn', () => {
  it('invokes openclaw with the per-thread session key and posts the reply', async () => {
    const invoke = vi.fn(async () => 'all green')
    const post = vi.fn(async () => {})
    await runOpenclawTurn(agent, rt, message, post, { invoke })

    expect(invoke).toHaveBeenCalledWith(agent, rt, 'status?', 'room1:thread1')
    expect(post).toHaveBeenCalledWith('room1', 'all green', { replyTo: 'msg-7', threadId: 'thread1' })
  })

  it('does not post when openclaw returns an empty reply', async () => {
    const invoke = vi.fn(async () => '')
    const post = vi.fn(async () => {})
    await runOpenclawTurn(agent, rt, message, post, { invoke })

    expect(invoke).toHaveBeenCalledOnce()
    expect(post).not.toHaveBeenCalled()
  })
})

describe('resolveOpenclawGatewayKey', () => {
  const log = () => {}
  const idp = { idp: 'https://id.openape.ai', access_token: 'idp-tok', email: 'ceo@id.openape.ai', expires_at: 0, key_path: '' } as any

  it('exchanges the agent IdP token for a DDISA gateway token (per agent home)', async () => {
    const ensureIdp = vi.fn(async () => idp)
    const exchange = vi.fn(async () => ({ access_token: 'ddisa-gw-tok' }) as any)
    const key = await resolveOpenclawGatewayKey('https://llms.openape.ai/v1', 'env-fallback', '/home/ceo', log, { ensureIdp, exchange })

    expect(key).toBe('ddisa-gw-tok')
    expect(ensureIdp).toHaveBeenCalledWith('/home/ceo')
    expect(exchange).toHaveBeenCalledWith(idp, { endpoint: 'https://llms.openape.ai', aud: 'llms.openape.ai' })
  })

  it('keeps the static fallback for a non-DDISA base (no exchange)', async () => {
    const exchange = vi.fn()
    const key = await resolveOpenclawGatewayKey('http://127.0.0.1:4000/v1', 'env-fallback', '/home/ceo', log, { ensureIdp: vi.fn(), exchange })

    expect(key).toBe('env-fallback')
    expect(exchange).not.toHaveBeenCalled()
  })

  it('falls back to the env key when the exchange fails (never strands the agent)', async () => {
    const ensureIdp = vi.fn(async () => idp)
    const exchange = vi.fn(async () => { throw new Error('exchange 500') })
    const key = await resolveOpenclawGatewayKey('https://llms.openape.ai/v1', 'env-fallback', '/home/ceo', log, { ensureIdp, exchange })

    expect(key).toBe('env-fallback')
  })
})
