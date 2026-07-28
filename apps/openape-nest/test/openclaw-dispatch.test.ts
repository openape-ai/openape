import { describe, expect, it, vi } from 'vitest'
import { resolveOpenclawGatewayKey, runOpenclawTurn } from '../src/lib/agent-runtime-session'

const agent = { name: 'ceo', email: 'ceo@id.openape.ai', home: '/home/ceo' }
const rt = { apiBase: 'https://llms.openape.ai/v1', apiKey: 'k', model: 'LocalCore-Thinking', systemPrompt: 'persona' }
const message = { body: 'status?', roomId: 'room1', threadId: 'thread1', id: 'msg-7' }

function chatSpy() {
  const postMessage = vi.fn(async () => ({ id: 'ph-1' }))
  const patchMessage = vi.fn(async () => {})
  return { postMessage, patchMessage }
}

describe('runOpenclawTurn', () => {
  it('posts a streaming placeholder (typing), invokes openclaw, patches the reply in', async () => {
    const invoke = vi.fn(async () => 'all green')
    const chat = chatSpy()
    await runOpenclawTurn(agent, rt, message, chat, { invoke })

    // typing placeholder first
    expect(chat.postMessage).toHaveBeenCalledWith('room1', '', { replyTo: 'msg-7', threadId: 'thread1', streaming: true })
    expect(invoke).toHaveBeenCalledWith(agent, rt, 'status?', 'room1:thread1')
    // finished reply patched into the placeholder, streaming cleared
    expect(chat.patchMessage).toHaveBeenCalledWith('ph-1', { body: 'all green', streaming: false })
  })

  it('clears the placeholder even when openclaw returns an empty reply', async () => {
    const invoke = vi.fn(async () => '')
    const chat = chatSpy()
    await runOpenclawTurn(agent, rt, message, chat, { invoke })

    expect(chat.postMessage).toHaveBeenCalledOnce()
    expect(chat.patchMessage).toHaveBeenCalledWith('ph-1', { body: '', streaming: false })
  })

  it('patches a failure note when the exec throws', async () => {
    const invoke = vi.fn(async () => { throw new Error('openclaw boom') })
    const chat = chatSpy()
    await expect(runOpenclawTurn(agent, rt, message, chat, { invoke })).rejects.toThrow('openclaw boom')
    expect(chat.patchMessage).toHaveBeenCalledWith('ph-1', { body: '⚠️ openclaw turn failed', streaming: false })
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
