// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { parseAgentRequest } from '../src/contracts/agent'
import { startAgentGateway } from '../src/worker/agent/gateway'
import { executeAgent } from '../src/worker/agent/executor'
import type { AgentRuntime } from '../src/worker/agent/executor'
import { endpointModel } from '../src/worker/agent/model'
import { superviseProcess } from '../src/worker/runtime/sandbox'
import type { ProcessDomain } from '../src/worker/runtime/sandbox'

vi.mock('../src/worker/runtime/sandbox', async original => ({ ...await original<typeof import('../src/worker/runtime/sandbox')>(), verifyExecutable: vi.fn(async () => {}), superviseProcess: vi.fn() }))

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

/** The SDK host as a completed process: records the thread options the desktop wrote for it. */
function completedSdk(threads: { model?: string }[]) {
  vi.mocked(superviseProcess).mockImplementation(async (_helper, _executable, args) => {
    threads.push((JSON.parse(await readFile(args[1]!, 'utf8')) as { thread: { model?: string } }).thread)
    const channel = new PassThrough(); const stderr = new PassThrough()
    channel.end(`${JSON.stringify({ type: 'complete', threadId: 'synthetic-thread', response: 'done' })}\n`); stderr.end()
    return { recordPath: '', guardian: null, channel, stdout: new PassThrough(), stderr, processId: Promise.resolve(1), completed: Promise.resolve(0), cancel: () => {} } as unknown as ProcessDomain
  })
}
async function bundledRuntime(): Promise<{ runtime: AgentRuntime, root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'pods-agent-model-'))
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ sdk: '0.153.4', binaryHash: 'a'.repeat(64), catalogHash: 'b'.repeat(64) }))
  await writeFile(join(root, 'models.json'), JSON.stringify({ models: [{ slug: 'fixture-model-a' }, { slug: 'fixture-model-b' }] }))
  return { root, runtime: { helper: '/unused', executable: process.execPath, entry: '/unused', runtimeDirectories: [], environment: {}, binary: join(root, 'codex'), catalog: join(root, 'models.json'), manifest: join(root, 'manifest.json'), sdkHost: '/unused/sdk-host.mjs' } }
}

it('runs each agent with the account default served by the desktop model gateway', async () => {
  let account = 'fixture-model-a'
  const desktop = await startAgentGateway({ provider: async () => new Response('{}'), model: async () => account }, new AbortController().signal)
  const { runtime, root } = await bundledRuntime(); const threads: { model?: string }[] = []
  completedSdk(threads)
  try {
    const model = endpointModel(`http://127.0.0.1:${desktop.port}/v1/model`, desktop.capability)
    const services = { provider: async () => new Response('{}'), model }
    await executeAgent(runtime, root, 'Synthetic task', [], services, new AbortController().signal, () => {})
    account = 'fixture-model-b'
    await executeAgent(runtime, root, 'Synthetic task', [], services, new AbortController().signal, () => {})
    expect(threads.map(thread => thread.model)).toEqual(['fixture-model-a', 'fixture-model-b'])
  }
  finally { await desktop.close(); await rm(root, { recursive: true, force: true }) }
})

it('fails clearly instead of choosing another model when the account default is unknown or unavailable', async () => {
  const { runtime, root } = await bundledRuntime(); const threads: { model?: string }[] = []
  completedSdk(threads)
  const provider = async () => new Response('{}')
  try {
    await expect(executeAgent(runtime, root, 'Synthetic task', [], { provider, model: async () => 'fixture-model-newer' }, new AbortController().signal, () => {})).rejects.toThrow('(fixture-model-newer) is not in the bundled Codex model catalog. Update OpenApe Pods')
    await expect(executeAgent(runtime, root, 'Synthetic task', [], { provider }, new AbortController().signal, () => {})).rejects.toThrow('Connect Codex')
    const failing = await startAgentGateway({ provider, model: async () => { throw new Error('The connected ChatGPT account reports no default model') } }, new AbortController().signal)
    try { await expect(executeAgent(runtime, root, 'Synthetic task', [], { provider, model: endpointModel(`http://127.0.0.1:${failing.port}/v1/model`, failing.capability) }, new AbortController().signal, () => {})).rejects.toThrow('reports no default model') }
    finally { await failing.close() }
    expect(threads).toEqual([])
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

it('offers the model endpoint only on a gateway that has a model connection', async () => {
  const run = await startAgentGateway({ provider: async () => new Response('{}'), tool: async () => ({}) }, new AbortController().signal)
  try {
    const response = await fetch(`http://127.0.0.1:${run.port}/v1/model`, { method: 'POST', headers: { Authorization: `Bearer ${run.capability}` }, body: '{}' })
    expect(response.status).toBe(405)
  }
  finally { await run.close() }
})
