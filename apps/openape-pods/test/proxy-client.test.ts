// @vitest-environment node
import { createServer } from 'node:http'
import type { Server, IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { proxyAgentCall, proxyAgentValidation } from '../src/worker/agent/proxy-client'
import type { ProxyAgentRequest } from '../src/contracts/agent'
import type { AgentCallMetadata } from '../src/contracts/agent-metadata'

const servers: Server[] = []
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } })
const capability = 'a'.repeat(64)
async function endpoint(handler: (request: IncomingMessage, response: ServerResponse) => void, drain?: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer((request, response) => {
    if (request.url === '/v1/proxy/cancel') {
      if (drain) {
        drain(request, response)
      }
      else { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ drained: true })) }; return
    }
    handler(request, response)
  }); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { port: (server.address() as { port: number }).port, capability }
}
const request: ProxyAgentRequest = { backend: 'proxy', provider: 'codex', modelSize: 'large', thinking: 'xhigh', prompt: 'Fixture text', tools: [], timeoutSeconds: 30 }
function metadata(status: AgentCallMetadata['status']): AgentCallMetadata {
  return { callId: 'fixture-call', backend: 'proxy', provider: 'codex', modelSize: 'large', modelId: 'gpt-6.1-sol', reportedModelId: status === 'completed' ? 'gpt-6.1-sol' : null, requestedThinking: 'xhigh', effectiveThinking: 'xhigh', wireThinking: { reasoning_effort: 'xhigh' }, configRevision: 'fixture-1', configHash: 'b'.repeat(64), startedAt: new Date().toISOString(), endedAt: status === 'running' ? null : new Date().toISOString(), durationMs: status === 'running' ? null : 1, status, threadId: 'proxy-call:fixture-call' }
}
const line = (value: unknown) => `${JSON.stringify(value)}\n`

it('uses the private fixed route and returns only text plus the local correlation ID', async () => {
  let body = ''; let headers: IncomingMessage['headers'] = {}; let path = ''
  const target = await endpoint((incoming, response) => {
    headers = incoming.headers; path = incoming.url!
    incoming.on('data', (chunk) => { body += String(chunk) })
    incoming.on('end', () => response.end(line({ type: 'metadata', metadata: metadata('running') }) + line({ type: 'metadata', metadata: metadata('completed') }) + line({ type: 'complete', threadId: 'proxy-call:fixture-call', response: 'Exact fixture text' })))
  })
  const events: AgentCallMetadata[] = []
  const result = await proxyAgentCall(target)(request, new AbortController().signal, value => events.push(value))
  expect(path).toBe('/v1/proxy')
  expect(headers.authorization).toBe(`Bearer ${capability}`)
  expect(headers['x-pod-agent-call']).toMatch(/^[a-f0-9-]{36}$/)
  expect(JSON.parse(body)).toEqual(request)
  expect(result).toEqual({ response: 'Exact fixture text', threadId: 'proxy-call:fixture-call' })
  expect(events.map(event => event.status)).toEqual(['running', 'completed'])
  expect(events[1]).toMatchObject({ modelId: 'gpt-6.1-sol', requestedThinking: 'xhigh', configRevision: 'fixture-1' })
})

it.each(['cancelled', 'timeout'] as const)('closes an unfinished response and records one %s terminal with the resolved snapshot', async (status) => {
  let closed = false
  const target = await endpoint((_incoming, response) => {
    response.on('close', () => { closed = true })
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
    response.write(line({ type: 'metadata', metadata: metadata('running') }))
  })
  const controller = new AbortController()
  const events: AgentCallMetadata[] = []
  const call = proxyAgentCall(target)({ ...request, timeoutSeconds: status === 'timeout' ? 0.1 : 30 }, controller.signal, (value) => { events.push(value); if (status === 'cancelled' && value.status === 'running') controller.abort(new Error('Fixture cancellation')) })
  await expect(call).rejects.toMatchObject({ code: status, metadata: expect.objectContaining({ modelId: 'gpt-6.1-sol', configRevision: 'fixture-1', status }) })
  await expect.poll(() => closed).toBe(true)
  expect(events.map(event => event.status)).toEqual(['running', status])
  expect(events[1]?.endedAt).toEqual(expect.any(String))
})

it('preserves safe errors and the frozen snapshot without leaking the prompt or capability', async () => {
  const target = await endpoint((_incoming, response) => response.end(line({ type: 'metadata', metadata: metadata('running') }) + line({ type: 'error', error: { code: 'rate_limited', message: 'Provider rate limit', details: { phase: 'request', httpStatus: 429, retryAfter: '12' } } })))
  const events: AgentCallMetadata[] = []
  await expect(proxyAgentCall(target)(request, new AbortController().signal, value => events.push(value))).rejects.toMatchObject({ code: 'rate_limited', details: { phase: 'request', httpStatus: 429, retryAfter: '12' } })
  expect(events.map(event => event.status)).toEqual(['running', 'failed'])
  expect(JSON.stringify(events)).not.toContain(request.prompt)
  expect(JSON.stringify(events)).not.toContain(capability)
})

it('never publishes a completed terminal when cancellation arrives with completion', async () => {
  const controller = new AbortController()
  const target = await endpoint((_incoming, response) => response.end(line({ type: 'metadata', metadata: metadata('running') }) + line({ type: 'metadata', metadata: metadata('completed') }) + line({ type: 'complete', threadId: 'proxy-call:fixture-call', response: 'Must not succeed' })))
  const events: AgentCallMetadata[] = []
  await expect(proxyAgentCall(target)(request, controller.signal, (value) => { events.push(value); if (value.status === 'running') controller.abort() })).rejects.toMatchObject({ code: 'cancelled' })
  expect(events.map(event => event.status)).toEqual(['running', 'cancelled'])
})

it('rejects a truncated private stream', async () => {
  const target = await endpoint((_incoming, response) => response.end(line({ type: 'metadata', metadata: metadata('running') })))
  await expect(proxyAgentCall(target)(request, new AbortController().signal, () => {})).rejects.toMatchObject({ code: 'response_truncated' })
})

it('validates via the host resolver without creating an inference request', async () => {
  const paths: string[] = []
  const target = await endpoint((incoming, response) => { paths.push(incoming.url!); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ valid: true })) })
  await proxyAgentValidation(target)(request, new AbortController().signal)
  expect(paths).toEqual(['/v1/proxy/validate'])
})

it('preserves a disabled mapping refusal during synthetic validation', async () => {
  const target = await endpoint((_incoming, response) => { response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { code: 'model_unavailable', message: 'Mapping is disabled', details: { phase: 'resolve' } } })) })
  await expect(proxyAgentValidation(target)(request, new AbortController().signal)).rejects.toMatchObject({ code: 'model_unavailable', details: { phase: 'resolve' } })
})

it('waits for trusted host cleanup before rejecting cancellation', async () => {
  let release!: () => void; let draining = false; let settled = false
  const target = await endpoint((_incoming, response) => response.write(line({ type: 'metadata', metadata: metadata('running') })), (_incoming, response) => {
    draining = true
    release = () => response.end(JSON.stringify({ drained: true }))
  })
  const controller = new AbortController()
  const call = proxyAgentCall(target)(request, controller.signal, (value) => { if (value.status === 'running') controller.abort() })
  const rejected = expect(call).rejects.toMatchObject({ code: 'cancelled' })
  void call.catch(() => { settled = true })
  await expect.poll(() => draining).toBe(true)
  expect(settled).toBe(false)
  release(); await rejected
  expect(settled).toBe(true)
})

it('reports unconfirmed host cleanup instead of treating socket closure as completion', async () => {
  const target = await endpoint((_incoming, response) => response.write(line({ type: 'metadata', metadata: metadata('running') })), (_incoming, response) => response.end(JSON.stringify({ drained: false })))
  const controller = new AbortController()
  const events: AgentCallMetadata[] = []
  await expect(proxyAgentCall(target)(request, controller.signal, (value) => { events.push(value); if (value.status === 'running') controller.abort() })).rejects.toMatchObject({ code: 'proxy_unreachable', details: { phase: 'read', cause: 'proxy_cleanup_unconfirmed' } })
  expect(events.map(event => event.status)).toEqual(['running', 'failed'])
})
