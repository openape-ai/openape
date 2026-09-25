// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { parseAgentRequest } from '../src/contracts/agent'
import { startAgentGateway } from '../src/worker/agent/gateway'

describe('agent capability gateway', () => {
  it('rejects foreign capabilities, browser origins, resource helpers and post-cancellation calls', async () => {
    const controller = new AbortController(); const tool = vi.fn(); const provider = vi.fn()
    const first = await startAgentGateway({ tool, provider }, controller.signal)
    const second = await startAgentGateway({ tool, provider }, new AbortController().signal)
    const request = (token: string, value: unknown, origin?: string) => fetch(`http://127.0.0.1:${first.port}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(value) })
    try {
      const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
      expect((await request(second.capability, list)).status).toBe(403)
      expect((await request(first.capability, list, 'https://unassigned.invalid')).status).toBe(403)
      const body = await (await request(first.capability, list)).json()
      expect(body.result.tools.map((entry: { name: string }) => entry.name)).toEqual(['ape_shell'])
      for (const method of ['resources/list', 'resources/read', 'resources/templates/list', 'prompts/get']) {
        expect(await (await request(first.capability, { ...list, method })).json()).toMatchObject({ error: { code: -32601 } })
      }
      expect(await (await request(first.capability, { ...list, method: 'tools/call', params: { name: 'exec_command', arguments: {} } })).json()).toMatchObject({ error: { code: -32601 } })
      controller.abort()
      expect((await request(first.capability, list)).status).toBe(403)
      expect(tool).not.toHaveBeenCalled(); expect(provider).not.toHaveBeenCalled()
    }
    finally { await first.close(); await second.close() }
  })
})

it('rejects oversized provider streams and releases their producer', async () => {
  let cancelled = false; let chunks = 0
  const gateway = await startAgentGateway({ tool: async () => ({}), provider: async () => new Response(new ReadableStream({ pull(controller) { if (chunks++ >= 20) controller.close(); else controller.enqueue(new Uint8Array(1024 * 1024)) }, cancel() { cancelled = true } })) }, new AbortController().signal)
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

it('advertises assigned application invocations to the agent without credential or HTTP tools', async () => {
  const tool = vi.fn(async () => ({ exitCode: 0, stdout: 'Synthetic read', stderr: '' }))
  const gateway = await startAgentGateway({ tool, provider: async () => new Response() }, new AbortController().signal)
  const rpc = async (method: string, params?: unknown) => (await fetch(`http://127.0.0.1:${gateway.port}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${gateway.capability}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()
  try {
    const list = await rpc('tools/list')
    expect(list.result.tools).toHaveLength(1)
    expect(list.result.tools[0].inputSchema.properties.applicationId).toEqual({ type: 'string' })
    expect(list.result.tools[0].inputSchema.oneOf).toEqual([{ required: ['application'] }, { required: ['applicationId'] }, { required: ['toolId'] }])
    const invocation = { application: 'assigned-application', argv: ['pods', 'read'] }
    expect((await rpc('tools/call', { name: 'ape_shell', arguments: invocation })).result.isError).toBeUndefined()
    expect(tool).toHaveBeenCalledWith(invocation, expect.any(AbortSignal))
    for (const name of ['credentials.get', 'http.request']) expect((await rpc('tools/call', { name, arguments: {} })).error.code).toBe(-32601)
    expect(tool).toHaveBeenCalledTimes(1)
  }
  finally { await gateway.close() }
})

it('defaults to no tools and rejects unknown or ambiguous agent permissions', () => {
  expect(parseAgentRequest({ prompt: 'Summarize' })).toEqual({ prompt: 'Summarize', tools: [], timeoutSeconds: 120 })
  expect(parseAgentRequest({ prompt: 'Summarize', tools: [] }).tools).toEqual([])
  expect(parseAgentRequest({ prompt: 'Read', tools: ['ape_shell'] }).tools).toEqual(['ape_shell'])
  for (const tools of [true, false, null, 'ape_shell', ['shell'], ['ape_shell', 'ape_shell']]) expect(() => parseAgentRequest({ prompt: 'Read', tools })).toThrow()
  expect(() => parseAgentRequest({ prompt: 'Read', allowTools: true })).toThrow()
  expect(() => parseAgentRequest({ prompt: ' ' })).toThrow()
})

it('removes provider tool declarations and rejects direct tool calls without a broker', async () => {
  const provider = vi.fn(async () => new Response('{}'))
  const gateway = await startAgentGateway({ provider }, new AbortController().signal)
  const request = async (path: string, value: unknown) => (await fetch(`http://127.0.0.1:${gateway.port}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${gateway.capability}` }, body: JSON.stringify(value) })).json()
  try {
    expect(await request('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).toMatchObject({ result: { tools: [] } })
    expect(await request('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ape_shell', arguments: { application: 'fixture', argv: ['read'] } } })).toMatchObject({ error: { code: -32601 } })
    await request('/v1/responses', { model: 'fixture', tools: [{ type: 'web_search' }], tool_choice: 'required', parallel_tool_calls: true })
    expect(provider).toHaveBeenCalledExactlyOnceWith({ model: 'fixture', tools: [], tool_choice: 'none', parallel_tool_calls: false }, expect.any(AbortSignal))
  }
  finally { await gateway.close() }
})

it('bounds each agent call with an explicit timeout', () => {
  expect(parseAgentRequest({ prompt: 'Summarize' })).toEqual({ prompt: 'Summarize', tools: [], timeoutSeconds: 120 })
  expect(parseAgentRequest({ prompt: 'Summarize', tools: [], timeoutSeconds: 900 }).timeoutSeconds).toBe(900)
  for (const timeoutSeconds of [29, 901, 60.5, '60']) expect(() => parseAgentRequest({ prompt: 'Summarize', timeoutSeconds })).toThrow('timeoutSeconds')
})
