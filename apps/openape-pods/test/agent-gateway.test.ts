// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
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
import type { AgentCallMetadata } from '../src/contracts/agent-metadata'

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
    const metadata: AgentCallMetadata[] = []
    await executeAgent(runtime, root, 'Synthetic task', [], services, new AbortController().signal, () => {}, [], 120, value => metadata.push(value))
    account = 'fixture-model-b'
    await executeAgent(runtime, root, 'Synthetic task', [], services, new AbortController().signal, () => {}, [], 120, value => metadata.push(value))
    expect(threads.map(thread => thread.model)).toEqual(['fixture-model-a', 'fixture-model-b'])
    expect(metadata.map(call => [call.status, call.modelId])).toEqual([['running', 'fixture-model-a'], ['completed', 'fixture-model-a'], ['running', 'fixture-model-b'], ['completed', 'fixture-model-b']])
    expect(metadata[1]).toMatchObject({ modelSelection: 'account-default', effectiveThinking: null, configRevision: null, threadId: 'synthetic-thread' })
    expect(metadata[0]?.modelId).toBe('fixture-model-a')
    expect(metadata[1]).not.toHaveProperty('usage')
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

it('preserves native cancellation messages while recording one safe terminal before model resolution', async () => {
  const { runtime, root } = await bundledRuntime()
  const controller = new AbortController()
  const metadata: AgentCallMetadata[] = []
  let requested!: () => void
  const started = new Promise<void>(resolve => { requested = resolve })
  const operation = executeAgent(runtime, root, 'Native fixture prompt', [], {
    provider: async () => new Response('{}'),
    model: async signal => {
      requested()
      return new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    },
  }, controller.signal, () => {}, [], 120, value => metadata.push(value))
  const refused = expect(operation).rejects.toThrow('Owner cancelled fixture')
  try {
    await started
    controller.abort(new Error('Owner cancelled fixture'))
    await refused
    expect(metadata).toHaveLength(1)
    expect(metadata[0]).toMatchObject({ backend: 'native', provider: 'codex', modelId: null, status: 'cancelled', effectiveThinking: null, error: { code: 'cancelled', message: 'Native agent call cancelled' } })
    expect(JSON.stringify(metadata)).not.toContain('Owner cancelled fixture')
    expect(JSON.stringify(metadata)).not.toContain('Native fixture prompt')
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
