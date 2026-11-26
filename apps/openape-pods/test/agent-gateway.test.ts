// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { parseAgentRequest } from '../src/contracts/agent'
import { startAgentGateway } from '../src/worker/agent/gateway'

const proxyFields = { backend: 'proxy', provider: 'claude', modelSize: 'small' } as const

describe('agent capability gateway', () => {
  it('rejects foreign capabilities, browser origins, the removed MCP endpoint and post-cancellation calls', async () => {
    const controller = new AbortController(); const provider = vi.fn(async () => new Response('{}'))
    const first = await startAgentGateway({ provider }, controller.signal)
    const second = await startAgentGateway({ provider }, new AbortController().signal)
    const request = (token: string, path = '/v1/responses', origin?: string) => fetch(`http://127.0.0.1:${first.port}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...(origin ? { Origin: origin } : {}) }, body: '{}' })
    try {
      expect((await request(second.capability)).status).toBe(403)
      expect((await request(first.capability, '/v1/responses', 'https://unassigned.invalid')).status).toBe(403)
      expect((await request(first.capability, '/mcp')).status).toBe(405)
      controller.abort()
      expect((await request(first.capability)).status).toBe(403)
      expect(provider).not.toHaveBeenCalled()
    }
    finally { await first.close(); await second.close() }
  })
})

it('rejects oversized provider streams and releases their producer', async () => {
  let cancelled = false; let chunks = 0
  const gateway = await startAgentGateway({ provider: async () => new Response(new ReadableStream({ pull(controller) { if (chunks++ >= 20) controller.close(); else controller.enqueue(new Uint8Array(1024 * 1024)) }, cancel() { cancelled = true } })) }, new AbortController().signal)
  try {
    const response = await fetch(`http://127.0.0.1:${gateway.port}/v1/responses`, { method: 'POST', headers: { Authorization: `Bearer ${gateway.capability}` }, body: '{}' })
    let rejected = false
    try { await response.arrayBuffer() }
    catch { rejected = true }
    expect(rejected).toBe(true)
    expect(cancelled).toBe(true)
  }
  finally { await gateway.close() }
})

it('defaults to no tools and rejects unknown or ambiguous agent permissions', () => {
  expect(parseAgentRequest({ ...proxyFields, prompt: 'Summarize' })).toEqual({ ...proxyFields, prompt: 'Summarize', tools: [], timeoutSeconds: 120 })
  expect(parseAgentRequest({ ...proxyFields, prompt: 'Summarize', tools: [] }).tools).toEqual([])
  for (const request of [{ prompt: 'Read', tools: ['ape_shell'] }, { backend: 'proxy', provider: 'claude', modelSize: 'small', prompt: 'Read', tools: ['ape_shell'] }]) {
    expect(() => parseAgentRequest(request)).toThrow(expect.objectContaining({ code: 'unsupported_combination', message: expect.stringContaining('ape_shell agent tool was removed') }))
  }
  for (const tools of [true, false, null, 'ape_shell', ['shell']]) expect(() => parseAgentRequest({ ...proxyFields, prompt: 'Read', tools })).toThrow()
  expect(() => parseAgentRequest({ prompt: 'Read', allowTools: true })).toThrow()
  expect(() => parseAgentRequest({ prompt: ' ' })).toThrow()
})

it('removes provider tool declarations and offers no MCP tool endpoint', async () => {
  const provider = vi.fn(async () => new Response('{}'))
  const gateway = await startAgentGateway({ provider }, new AbortController().signal)
  const request = async (path: string, value: unknown) => (await fetch(`http://127.0.0.1:${gateway.port}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${gateway.capability}` }, body: JSON.stringify(value) })).json()
  try {
    expect(await request('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).toEqual({ error: 'Unsupported agent endpoint' })
    await request('/v1/responses', { model: 'fixture', tools: [{ type: 'web_search' }], tool_choice: 'required', parallel_tool_calls: true })
    expect(provider).toHaveBeenCalledExactlyOnceWith({ model: 'fixture', tools: [], tool_choice: 'none', parallel_tool_calls: false }, expect.any(AbortSignal))
  }
  finally { await gateway.close() }
})

it('bounds each agent call with an explicit timeout', () => {
  expect(parseAgentRequest({ ...proxyFields, prompt: 'Summarize' })).toEqual({ ...proxyFields, prompt: 'Summarize', tools: [], timeoutSeconds: 120 })
  expect(parseAgentRequest({ ...proxyFields, prompt: 'Summarize', tools: [], timeoutSeconds: 900 }).timeoutSeconds).toBe(900)
  for (const timeoutSeconds of [29, 901, 60.5, '60']) expect(() => parseAgentRequest({ ...proxyFields, prompt: 'Summarize', timeoutSeconds })).toThrow('timeoutSeconds')
})

it('rejects the removed native backend and an omitted backend with the proxy fields to use', () => {
  for (const request of [{ prompt: 'Summarize' }, { prompt: 'Summarize', backend: 'native' }, { prompt: 'Summarize', backend: 'native', provider: 'codex' }]) {
    expect(() => parseAgentRequest(request)).toThrow('agent.run requires backend:"proxy" with provider ("claude" or "codex") and modelSize')
    try { parseAgentRequest(request) }
    catch (error) { expect(error).toMatchObject({ code: 'unsupported_combination' }) }
  }
})

it('offers the model endpoint only on a gateway that has a model connection', async () => {
  const run = await startAgentGateway({ provider: async () => new Response('{}') }, new AbortController().signal)
  try {
    const response = await fetch(`http://127.0.0.1:${run.port}/v1/model`, { method: 'POST', headers: { Authorization: `Bearer ${run.capability}` }, body: '{}' })
    expect(response.status).toBe(405)
  }
  finally { await run.close() }
})

it('keeps proxy calls behind a private capability and refuses caller-controlled transport and tools', async () => {
  const proxy = vi.fn(async () => ({ response: 'synthetic result', threadId: 'proxy-call:synthetic' }))
  const validate = vi.fn()
  const gateway = await startAgentGateway({ provider: async () => new Response('{}'), proxy, proxyValidate: validate }, new AbortController().signal)
  const request = { backend: 'proxy', provider: 'claude', modelSize: 'medium', thinking: 'high', prompt: 'Synthetic task' }
  const post = (path: string, value: unknown, capability = gateway.capability) => fetch(`http://127.0.0.1:${gateway.port}${path}`, { method: 'POST', headers: { authorization: `Bearer ${capability}`, 'content-type': 'application/json', 'X-Pod-Agent-Call': randomUUID() }, body: JSON.stringify(value) })
  try {
    expect((await post('/v1/proxy', request, 'wrong')).status).toBe(403)
    expect((await post('/v1/messages', request)).status).toBe(405)
    for (const extra of [{ tools: ['ape_shell'] }, { baseUrl: 'http://attacker.invalid' }, { model: 'replacement' }, { headers: { authorization: 'secret' } }]) {
      const reply = await post('/v1/proxy', { ...request, ...extra })
      expect(await reply.text()).toContain('"type":"error"')
    }
    expect(proxy).not.toHaveBeenCalled()
    expect(await (await post('/v1/proxy/validate', request)).json()).toEqual({ valid: true })
    expect(validate).toHaveBeenCalledOnce()
    expect(proxy).not.toHaveBeenCalled()
    const frames = (await (await post('/v1/proxy', request)).text()).trim().split('\n').map(line => JSON.parse(line))
    expect(frames).toEqual([{ type: 'complete', response: 'synthetic result', threadId: 'proxy-call:synthetic' }])
    expect(proxy).toHaveBeenCalledOnce()
  }
  finally { await gateway.close() }
})

it('drains active proxy work when its gateway closes', async () => {
  let began: () => void = () => {}
  const started = new Promise<void>((resolve) => { began = resolve })
  let drained = false
  const gateway = await startAgentGateway({
    provider: async () => new Response('{}'),
    proxy: async (_request, signal) => {
      began()
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => resolve(), { once: true }) })
      drained = true
      signal.throwIfAborted()
      throw new Error('Unreachable')
    },
  }, new AbortController().signal)
  const call = fetch(`http://127.0.0.1:${gateway.port}/v1/proxy`, { method: 'POST', headers: { authorization: `Bearer ${gateway.capability}`, 'content-type': 'application/json', 'X-Pod-Agent-Call': randomUUID() }, body: JSON.stringify({ backend: 'proxy', provider: 'codex', modelSize: 'small', prompt: 'Synthetic task' }) }).catch(() => null)
  await started
  await gateway.close()
  expect(drained).toBe(true)
  await call
})

it('acknowledges cancellation only after drain and prevents a delayed cancelled request from starting', async () => {
  let began: () => void = () => {}
  const started = new Promise<void>((resolve) => { began = resolve })
  let drained = false
  const proxy = vi.fn(async (_request, signal: AbortSignal) => {
    began()
    await new Promise<void>((resolve) => { signal.addEventListener('abort', () => resolve(), { once: true }) })
    await new Promise(resolve => setTimeout(resolve, 20))
    drained = true
    signal.throwIfAborted()
    throw new Error('Unreachable')
  })
  const gateway = await startAgentGateway({ provider: async () => new Response('{}'), proxy }, new AbortController().signal)
  const post = (path: string, value: unknown, id = randomUUID()) => fetch(`http://127.0.0.1:${gateway.port}${path}`, { method: 'POST', headers: { authorization: `Bearer ${gateway.capability}`, 'content-type': 'application/json', 'X-Pod-Agent-Call': id }, body: JSON.stringify(value) })
  const request = { backend: 'proxy', provider: 'codex', modelSize: 'small', prompt: 'Synthetic task' }
  try {
    const delayedId = randomUUID()
    expect(await (await post('/v1/proxy/cancel', { id: delayedId })).json()).toEqual({ drained: true })
    expect((await post('/v1/proxy', request, delayedId)).status).toBe(409)
    expect(proxy).not.toHaveBeenCalled()
    const activeId = randomUUID()
    const active = post('/v1/proxy', request, activeId).catch(() => null)
    await started
    expect(await (await post('/v1/proxy/cancel', { id: activeId })).json()).toEqual({ drained: true })
    expect(drained).toBe(true)
    await active
  }
  finally { await gateway.close() }
})
