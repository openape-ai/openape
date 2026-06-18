import { describe, expect, it, vi } from 'vitest'
import { resolveLlmGatewayKey } from '../src/llm-gateway-key'

describe('resolveLlmGatewayKey', () => {
  it('keeps the static key for a non-gateway base (loopback codex-proxy)', async () => {
    const exchange = vi.fn()
    const key = await resolveLlmGatewayKey('http://127.0.0.1:4001/v1', 'static-key', () => {}, exchange)
    expect(key).toBe('static-key')
    expect(exchange).not.toHaveBeenCalled()
  })

  it('exchanges the agent DDISA token for an llms.openape.ai gateway and strips the Bearer prefix', async () => {
    const exchange = vi.fn(async () => 'Bearer ddisa-token-abc')
    const key = await resolveLlmGatewayKey('https://llms.openape.ai/v1', 'static-key', () => {}, exchange)
    expect(key).toBe('ddisa-token-abc')
    expect(exchange).toHaveBeenCalledWith({ endpoint: 'https://llms.openape.ai', aud: 'llms.openape.ai' })
  })

  it('falls back to the current key (and logs) when the exchange throws', async () => {
    const logs: string[] = []
    const exchange = vi.fn(async () => { throw new Error('exchange 401') })
    const key = await resolveLlmGatewayKey('https://llms.openape.ai/v1', 'static-key', l => logs.push(l), exchange)
    expect(key).toBe('static-key')
    expect(logs.join('\n')).toMatch(/exchange/i)
  })
})
