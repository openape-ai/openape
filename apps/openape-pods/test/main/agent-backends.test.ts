// @vitest-environment node
import { createServer } from 'node:http'
import type { Server, IncomingMessage, ServerResponse } from 'node:http'
import { chmod, link, mkdtemp, realpath, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { agentModelSizes, agentProviders, agentThinkingLevels, parseAgentRequest } from '../../src/contracts/agent'
import type { ProxyAgentRequest } from '../../src/contracts/agent'
import type { AgentCallMetadata } from '../../src/contracts/agent-metadata'
import { AgentBackendManager } from '../../src/main/agent-backends/manager'
import { parseModelApiConfig } from '../../src/main/agent-backends/model-config'
import { configurationHash, parseAgentBackendConfig, resolveProxyRequest } from '../../src/main/agent-backends/config'
import { normalizeProxyResponse, proxyPayload, proxyResponseBytes } from '../../src/main/agent-backends/transport'
import { readPrivateJson } from '../../src/main/agent-backends/private-file'
import * as privateFile from '../../src/main/agent-backends/private-file'
import { approvedAgentBackendConfig } from './agent-backend-fixture'

const roots: string[] = []; const servers: Server[] = []; const managers: AgentBackendManager[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(managers.splice(0).map(manager => manager.drain()))
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) })))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
const request = (provider: 'claude' | 'codex' = 'codex', extra: object = {}): ProxyAgentRequest => parseAgentRequest({ backend: 'proxy', provider, modelSize: 'small', prompt: 'Return the marker.', ...extra }) as ProxyAgentRequest
const config = () => approvedAgentBackendConfig('/private/fake-key.json')
const snapshot = (provider: 'claude' | 'codex' = 'codex', extra: object = {}) => resolveProxyRequest(config(), request(provider, extra))
const chat = (model = 'gpt-6-luna', extra: object = {}) => ({ id: 'chat-123', model, choices: [{ message: { role: 'assistant', content: 'marker' }, finish_reason: 'stop', native_finish_reason: 'completed' }], ...extra })
const messages = () => ({ id: 'message-123', type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001', content: [{ type: 'thinking', thinking: 'private reasoning' }, { type: 'text', text: 'marker' }], stop_reason: 'end_turn' })

async function fixture(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.end(JSON.stringify({ data: Object.values(config().proxy.models).flatMap(provider => Object.values(provider).map(entry => ({ id: entry.modelId, max_tokens: 128000 }))) })); return
    }
    handler(request, response)
  }); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-agent-backends-'))); roots.push(root)
  const keyFile = join(root, 'key.json'); const configFile = join(root, 'agent-backends.json')
  await writeFile(keyFile, JSON.stringify({ api_key: 'synthetic-private-key' }), { mode: 0o600 })
  const value = structuredClone(approvedAgentBackendConfig(keyFile, `http://127.0.0.1:${address.port}/v1`))
  await writeFile(configFile, JSON.stringify(value), { mode: 0o600 })
  const manager = new AgentBackendManager({ profileRoot: root }); managers.push(manager)
  await manager.reload()
  return { root, keyFile, configFile, config: value, manager }
}

it('retains legacy null timeout and strictly validates every new selection field', () => {
  expect(parseAgentRequest({ prompt: 'old', timeoutSeconds: null })).toEqual({ prompt: 'old', tools: [], timeoutSeconds: 120 })
  for (const value of [{ backend: null }, { backend: undefined }, { provider: 'claude' }, { provider: null }, { modelSize: 'small' }, { thinking: 'high' }, { backend: 'proxy' }, { backend: 'proxy', provider: 'claude' }, { backend: 'proxy', provider: 'claude', modelSize: null }, { backend: 'proxy', provider: 'claude', modelSize: 'small', thinking: null }, { backend: 'proxy', provider: 'claude', modelSize: 'small', tools: ['ape_shell'] }]) expect(() => parseAgentRequest({ prompt: 'test', ...value })).toThrow()
  for (const provider of agentProviders) {
    for (const modelSize of agentModelSizes) {
      for (const thinking of agentThinkingLevels) expect(request(provider, { modelSize, thinking })).toMatchObject({ provider, modelSize, thinking })
    }
  }
})

it('serializes all 32 explicit mappings and refuses disabled combinations without substitution', () => {
  for (const provider of agentProviders) {
    for (const modelSize of agentModelSizes) {
      for (const thinking of agentThinkingLevels) {
        const input = request(provider, { modelSize, thinking }); const resolved = resolveProxyRequest(config(), input); const payload = proxyPayload(resolved, input)
        expect(resolved.model.modelId).toBe(config().proxy.models[provider][modelSize]?.modelId)
        expect(resolved.effectiveThinking).toBe(thinking)
        if (provider === 'codex') {
          expect(payload).toMatchObject({ reasoning_effort: thinking, tools: [], tool_choice: 'none', stream: false })
        }
        else {
          expect(payload).toMatchObject({ fallbacks: [], tool_choice: { type: 'none' }, stream: false })
          if (modelSize === 'small') expect(payload).toMatchObject({ thinking: { type: 'enabled', budget_tokens: { low: 1024, medium: 8192, high: 24576, xhigh: 32768 }[thinking] }, max_tokens: 40960 })
          else expect(payload).toMatchObject({ thinking: { type: 'adaptive' }, output_config: { effort: thinking }, max_tokens: 16384 })
        }
      }
    }
  }
  expect(snapshot().effectiveThinking).toBe('medium')
  const changed = structuredClone(config()); const model = changed.proxy.models.codex.small
  if (!model) throw new Error('Missing fixture model')
  model.thinking.high.enabled = false
  expect(() => resolveProxyRequest(parseAgentBackendConfig(changed), request('codex', { thinking: 'high' }))).toThrow('disabled')
  model.enabled = false
  expect(() => resolveProxyRequest(parseAgentBackendConfig(changed), request())).toThrow('missing or disabled')
})

it('rejects malformed configuration, effort downgrade, budget clamp and unsafe destinations', () => {
  for (const baseUrl of ['http://example.com/v1', 'http://user:password@127.0.0.1/v1', 'http://127.0.0.1/v1?secret=a', 'http://127.0.0.1/v1#x', 'file:///v1']) expect(() => parseAgentBackendConfig({ ...config(), proxy: { ...config().proxy, baseUrl } })).toThrow()
  const changed = structuredClone(config()); const model = changed.proxy.models.claude.small
  if (!model) throw new Error('Missing fixture model')
  model.outputLimit = 32768
  expect(() => parseAgentBackendConfig(changed)).toThrow('budgets must fit')
  const adaptive = structuredClone(config()); const entry = adaptive.proxy.models.claude.medium
  if (!entry) throw new Error('Missing fixture model')
  entry.thinking.xhigh.translation = { type: 'adaptive', effort: 'high' }
  expect(() => parseAgentBackendConfig(adaptive)).toThrow('cannot be substituted')
})

it('normalizes only visible text and optional reported usage without inventing zero values', () => {
  expect(normalizeProxyResponse(messages(), snapshot('claude'))).toEqual({ response: 'marker', reportedModelId: 'claude-haiku-4-5-20251001', upstreamId: 'message-123' })
  expect(normalizeProxyResponse(chat(), snapshot()).usage).toBeUndefined()
  expect(normalizeProxyResponse(chat('gpt-6-luna', { usage: { prompt_tokens: 3, completion_tokens: 7, total_tokens: 10, completion_tokens_details: { reasoning_tokens: 2 }, prompt_tokens_details: { cached_tokens: 1 } } }), snapshot()).usage).toEqual({ source: 'chat-completions.usage', unit: 'tokens', input: 3, output: 7, total: 10, reasoning: 2, cacheRead: 1 })
})

it.each([
  ['model_mismatch', chat('different-model')],
  ['invalid_response', {}],
  ['invalid_response', chat('gpt-6-luna', { choices: [] })],
  ['invalid_response', chat('gpt-6-luna', { choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }] })],
  ['unexpected_tool_call', chat('gpt-6-luna', { choices: [{ message: { role: 'assistant', content: 'text', images: [{ url: 'hidden' }] }, finish_reason: 'stop' }] })],
  ['unexpected_tool_call', chat('gpt-6-luna', { choices: [{ message: { role: 'assistant', content: 'text', tool_calls: [{}] }, finish_reason: 'stop' }] })],
  ['response_truncated', chat('gpt-6-luna', { choices: [{ message: { role: 'assistant', content: 'text' }, finish_reason: 'stop', native_finish_reason: 'incomplete' }] })],
  ['response_truncated', chat('gpt-6-luna', { choices: [{ message: { role: 'assistant', content: 'text' }, finish_reason: 'length' }] })],
  ['response_too_large', chat('gpt-6-luna', { choices: [{ message: { role: 'assistant', content: 'x'.repeat(proxyResponseBytes) }, finish_reason: 'stop' }] })],
])('refuses unsafe response as %s', (code, value) => { expect(() => normalizeProxyResponse(value, snapshot())).toThrow(expect.objectContaining({ code })) })

it('refuses tool-bearing Claude replies even beside visible text', () => {
  expect(() => normalizeProxyResponse({ ...messages(), content: [{ type: 'text', text: 'text' }, { type: 'tool_use', name: 'tool' }] }, snapshot('claude'))).toThrow(expect.objectContaining({ code: 'unexpected_tool_call' }))
})

it('enforces private stable single-link files and never includes credential values or paths in errors', async () => {
  const f = await fixture((_request, response) => response.end(JSON.stringify(chat())))
  for (const permission of [0o644, 0o640]) { await chmod(f.keyFile, permission); await expect(readPrivateJson(f.keyFile, 'credential')).rejects.toMatchObject({ code: 'credential_unavailable' }) }
  await chmod(f.keyFile, 0o600)
  const symbolic = join(f.root, 'symbolic'); await symlink(f.keyFile, symbolic)
  await expect(readPrivateJson(symbolic, 'credential')).rejects.toMatchObject({ code: 'credential_unavailable' })
  const hard = join(f.root, 'hard'); await link(f.keyFile, hard)
  await expect(readPrivateJson(f.keyFile, 'credential')).rejects.toMatchObject({ code: 'credential_unavailable' })
  await rm(hard); await writeFile(f.keyFile, '{invalid-json-secret')
  const status = await f.manager.reload()
  expect(status).toMatchObject({ available: false, connections: expect.arrayContaining([expect.objectContaining({ error: expect.objectContaining({ code: 'credential_unavailable' }) })]) })
  expect(JSON.stringify(status)).not.toMatch(/invalid-json-secret|agent-backends.json|key.json/)
})

it('uses the fixed endpoint, exact payload and rotated key, emitting immutable complete safe metadata', async () => {
  const received: { url?: string, authorization?: string, body: unknown }[] = []
  const f = await fixture((incoming, response) => {
    const chunks: Buffer[] = []
    incoming.on('data', chunk => chunks.push(chunk))
    incoming.on('end', () => { received.push({ url: incoming.url, authorization: incoming.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) }); response.end(JSON.stringify(chat())) })
  })
  const events: AgentCallMetadata[] = []
  const result = await f.manager.run(request(), { onMetadata: event => events.push(event) })
  expect(result.response).toBe('marker')
  expect(events).toHaveLength(2)
  expect(events[0]).toMatchObject({ status: 'running', requestedThinking: null, effectiveThinking: 'medium', modelId: 'gpt-6-luna', configRevision: '1' })
  expect(events[1]).toMatchObject({ status: 'completed', reportedModelId: 'gpt-6-luna', upstreamId: 'chat-123' })
  expect(Object.isFrozen(events[0])).toBe(true)
  expect(Object.isFrozen(events[0].wireThinking)).toBe(true)
  expect(JSON.stringify(events)).not.toMatch(/synthetic-private-key|key.json|Return the marker/)
  expect(received[0]).toMatchObject({ url: '/v1/chat/completions', authorization: 'Bearer synthetic-private-key', body: { reasoning_effort: 'medium', tools: [], tool_choice: 'none' } })
  await writeFile(f.keyFile, JSON.stringify({ api_key: 'rotated-fake-key' }))
  await f.manager.run(request())
  expect(received[1].authorization).toBe('Bearer rotated-fake-key')
})

it.each([[401, 'proxy_unauthorized'], [403, 'proxy_unauthorized'], [404, 'provider_error'], [429, 'rate_limited'], [503, 'provider_error']] as const)('classifies HTTP %s without leaking error body or retrying', async (status, code) => {
  let count = 0
  const f = await fixture((_request, response) => { count++; response.writeHead(status, { 'retry-after': '7' }); response.end(JSON.stringify({ error: { message: 'private-key-and-prompt', code: 'not-a-safe-code' } })) })
  const error = await f.manager.run(request()).catch(error => error)
  expect(error).toMatchObject({ code, details: { httpStatus: status, retryAfter: '7' }, metadata: { status: 'failed' } })
  expect(JSON.stringify(error)).not.toContain('private-key-and-prompt')
  expect(count).toBe(1)
})

it('rejects redirects, malformed and oversized transport bodies with distinct causes', async () => {
  for (const [status, body, code] of [[307, '', 'proxy_unreachable'], [200, 'not-json', 'invalid_response'], [200, 'x'.repeat(proxyResponseBytes + 1), 'response_too_large']] as const) {
    const f = await fixture((_request, response) => { response.writeHead(status, { location: 'http://127.0.0.1:1/v1/messages' }); response.end(body) })
    await expect(f.manager.run(request())).rejects.toMatchObject({ code })
  }
})

it('preserves call snapshots across reload and requires restart for connection changes', async () => {
  const f = await fixture((_request, response) => response.end(JSON.stringify(chat())))
  const result = await f.manager.run(request()); const initialHash = result.metadata.configHash
  f.config.revision = '2'; const mapping = f.config.proxy.models.codex.small
  if (!mapping) throw new Error('Missing fixture mapping')
  mapping.thinking.high.enabled = false
  await writeFile(f.configFile, JSON.stringify(f.config))
  expect(await f.manager.reload()).toMatchObject({ revision: '2', available: true })
  expect(result.metadata.configRevision).toBe('1')
  expect(result.metadata.configHash).toBe(initialHash)
  expect(() => f.manager.validate(request('codex', { thinking: 'high' }))).toThrow('disabled')
  f.config.proxy.keyFile = join(f.root, 'new-key.json')
  await writeFile(f.configFile, JSON.stringify(f.config))
  expect(await f.manager.reload()).toMatchObject({ available: false, connections: expect.arrayContaining([expect.objectContaining({ restartRequired: true })]) })
  expect(f.manager.protectedPaths()).not.toContain(f.config.proxy.keyFile)
  await expect(f.manager.run(request())).rejects.toMatchObject({ code: 'proxy_not_configured' })
})

it('requires restart when configuration is first added after an absent startup baseline', async () => {
  const f = await fixture((_request, response) => response.end(JSON.stringify(chat())))
  await rm(f.configFile)
  const manager = new AgentBackendManager({ profileRoot: f.root }); managers.push(manager)
  await manager.reload()
  await writeFile(f.configFile, JSON.stringify(f.config), { mode: 0o600 })
  expect(await manager.reload()).toMatchObject({ available: false, connections: expect.arrayContaining([expect.objectContaining({ restartRequired: true })]) })
})

it('reads a repaired key on the next call without retaining an unavailable credential error', async () => {
  const f = await fixture((_request, response) => response.end(JSON.stringify(chat())))
  await rm(f.keyFile)
  expect(await f.manager.reload()).toMatchObject({ available: false, connections: expect.arrayContaining([expect.objectContaining({ error: expect.objectContaining({ code: 'credential_unavailable' }) })]) })
  await writeFile(f.keyFile, JSON.stringify({ api_key: 'repaired-fake-key' }), { mode: 0o600 })
  expect((await f.manager.run(request())).response).toBe('marker')
  expect(f.manager.status().available).toBe(true)
})

it('cancels slow response consumption, closes the socket, emits one terminal and drains', async () => {
  let connected: () => void = () => undefined; let disconnected: () => void = () => undefined
  const started = new Promise<void>((resolve) => { connected = resolve }); const closed = new Promise<void>((resolve) => { disconnected = resolve })
  const f = await fixture((_request, response) => { response.writeHead(200); response.write('{"model":'); response.on('close', disconnected); connected() })
  const controller = new AbortController(); const events: AgentCallMetadata[] = []
  const running = f.manager.run(request(), { signal: controller.signal, onMetadata: event => events.push(event) }).catch(error => error)
  await started; controller.abort()
  expect(await running).toMatchObject({ code: 'cancelled', metadata: { status: 'cancelled' } })
  await closed; await f.manager.drain()
  expect(events.filter(event => event.status !== 'running')).toHaveLength(1)
})

it('times out slow headers with full local cleanup and no success', async () => {
  let connected: () => void = () => undefined
  const started = new Promise<void>((resolve) => { connected = resolve })
  const f = await fixture(() => connected())
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const running = f.manager.run(request()).catch(error => error)
  await started; await vi.advanceTimersByTimeAsync(120000)
  expect(await running).toMatchObject({ code: 'timeout', metadata: { status: 'timeout' } })
})

it('persists Disable while drain leaves host configuration unchanged', async () => {
  const f = await fixture((_request, response) => response.end(JSON.stringify(chat())))
  const before = await readFile(f.configFile, 'utf8')
  await f.manager.drain()
  expect(await readFile(f.configFile, 'utf8')).toBe(before)
  await f.manager.reload(); await f.manager.disable()
  const persisted = parseModelApiConfig(JSON.parse(await readFile(f.configFile, 'utf8')))
  expect(Object.values(persisted.connections).every(connection => !connection.enabled)).toBe(true)
  expect(configurationHash(persisted)).toBe(f.manager.status().hash)
  const restarted = new AgentBackendManager({ profileRoot: f.root }); managers.push(restarted)
  expect(await restarted.reload()).toMatchObject({ enabled: false, available: false })
})

it('sends native Claude Messages with an empty fallback list and exact adaptive xhigh', async () => {
  const captured: unknown[] = []
  const f = await fixture((incoming, response) => {
    expect(incoming.url).toBe('/v1/messages')
    const chunks: Buffer[] = []
    incoming.on('data', chunk => chunks.push(chunk))
    incoming.on('end', () => { captured.push(JSON.parse(Buffer.concat(chunks).toString())); response.end(JSON.stringify({ ...messages(), model: 'claude-sonnet-5-5' })) })
  })
  expect((await f.manager.run(request('claude', { modelSize: 'medium', thinking: 'xhigh' }))).response).toBe('marker')
  expect(captured).toEqual([{ model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'Return the marker.' }], stream: false, max_tokens: 16384, tool_choice: { type: 'none' }, fallbacks: [], thinking: { type: 'adaptive' }, output_config: { effort: 'xhigh' } }])
})

it('keeps reported model identity on terminal mismatch failure', async () => {
  const f = await fixture((_request, response) => response.end(JSON.stringify(chat('gpt-other'))))
  await expect(f.manager.run(request())).rejects.toMatchObject({ code: 'model_mismatch', metadata: { modelId: 'gpt-6-luna', reportedModelId: 'gpt-other', upstreamId: 'chat-123', status: 'failed' } })
})

it('distinguishes known provider authentication failure from ambiguous proxy status', async () => {
  const f = await fixture((_request, response) => { response.writeHead(502); response.end(JSON.stringify({ error: { type: 'authentication_error', message: 'private provider message' } })) })
  await expect(f.manager.run(request())).rejects.toMatchObject({ code: 'provider_authentication_failed', details: { httpStatus: 502, providerCode: 'authentication_error' } })
})

it('preserves a safe connection cause without copying network internals', async () => {
  const f = await fixture((_request, response) => response.end(JSON.stringify(chat())))
  const manager = new AgentBackendManager({ profileRoot: f.root, fetch: vi.fn(async () => { throw new TypeError('private connection URL', { cause: { code: 'ECONNREFUSED', secret: 'private-key' } }) }) }); managers.push(manager)
  await manager.reload()
  const error = await manager.run(request()).catch(error => error)
  expect(error).toMatchObject({ code: 'proxy_unreachable', details: { phase: 'resolve', cause: 'ECONNREFUSED' } })
  expect(JSON.stringify(error)).not.toMatch(/private connection|private-key/)
})

it('times out slow body reads and preserves the read phase', async () => {
  let connected: () => void = () => undefined
  const started = new Promise<void>((resolve) => { connected = resolve })
  const f = await fixture((_request, response) => { response.writeHead(200); response.write('{'); connected() })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const running = f.manager.run(request()).catch(error => error)
  await started
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  await vi.advanceTimersByTimeAsync(120000)
  expect(await running).toMatchObject({ code: 'timeout', details: { phase: 'read' }, metadata: { status: 'timeout' } })
})

it('drains only proxy calls and persists disable after an in-flight request settles', async () => {
  let connected: () => void = () => undefined
  const started = new Promise<void>((resolve) => { connected = resolve })
  const f = await fixture((_request, response) => { response.writeHead(200); response.write('{'); connected() })
  const running = f.manager.run(request()).catch(error => error)
  await started; await f.manager.disable()
  expect(await running).toMatchObject({ code: 'cancelled', details: { cause: 'backend_disabled' } })
  expect(f.manager.status()).toMatchObject({ enabled: false, available: false })
  await expect(f.manager.run(request())).rejects.toMatchObject({ code: 'proxy_not_configured' })
})

it('invalid reload never falls back to an older valid configuration', async () => {
  const f = await fixture((_request, response) => response.end(JSON.stringify(chat())))
  await writeFile(f.configFile, '{invalid')
  expect(await f.manager.reload()).toMatchObject({ configured: false, available: false, error: { code: 'proxy_not_configured' } })
  await expect(f.manager.run(request())).rejects.toMatchObject({ code: 'proxy_not_configured' })
})

it('refuses overwriting owner configuration changed since reload when disabling', async () => {
  const f = await fixture((_request, response) => response.end(JSON.stringify(chat())))
  f.config.revision = 'owner-edited'
  await writeFile(f.configFile, JSON.stringify(f.config))
  await expect(f.manager.disable()).rejects.toMatchObject({ code: 'proxy_not_configured', details: { cause: 'configuration_changed' } })
  expect(JSON.parse(await readFile(f.configFile, 'utf8')).revision).toBe('owner-edited')
  expect(f.manager.status().enabled).toBe(false)
})

it('classifies model unavailability from an explicit provider code without guessing from HTTP 404', async () => {
  const f = await fixture((_request, response) => { response.writeHead(404); response.end(JSON.stringify({ error: { code: 'model_not_found' } })) })
  await expect(f.manager.run(request())).rejects.toMatchObject({ code: 'model_unavailable', details: { httpStatus: 404, providerCode: 'model_not_found' } })
})

it('serializes Reload and Disable so concurrent requests persist the final disabled state', async () => {
  const f = await fixture((_request, response) => response.end(JSON.stringify(chat())))
  let reading: () => void = () => undefined; let release: () => void = () => undefined
  const began = new Promise<void>((resolve) => { reading = resolve }); const held = new Promise<void>((resolve) => { release = resolve })
  const actual = privateFile.readPrivateJson
  const reader = vi.spyOn(privateFile, 'readPrivateJson').mockImplementationOnce(async (...args) => { reading(); await held; return actual(...args) })
  try {
    const reload = f.manager.reload()
    await began
    let disabled = false
    const disable = (async () => { await f.manager.disable(); disabled = true })()
    await new Promise(resolve => setImmediate(resolve))
    expect(disabled).toBe(false)
    release(); await reload; await disable
    expect(f.manager.status()).toMatchObject({ enabled: false, available: false })
    expect(JSON.parse(await readFile(f.configFile, 'utf8')).connections.openai.enabled).toBe(false)
  }
  finally { release(); reader.mockRestore() }
})
