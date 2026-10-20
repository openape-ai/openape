import { once } from 'node:events'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { parseAgentRequest } from '../../contracts/agent'
import type { ProxyAgentRequest } from '../../contracts/agent'
import type { AgentCallMetadata } from '../../contracts/agent-metadata'
import { AgentCallError, serializeSafeError } from '../../contracts/agent-errors'

export interface AgentGatewayServices {
  provider: (body: unknown, signal: AbortSignal) => Promise<Response>
  /** The connected account's default model; only the desktop's model connection gateway offers it. */
  model?: (signal: AbortSignal) => Promise<string>
  tool?: (body: unknown, signal: AbortSignal) => Promise<unknown>
  proxy?: (request: ProxyAgentRequest, signal: AbortSignal, onMetadata: (metadata: AgentCallMetadata) => void) => Promise<{ response: string, threadId: string }>
  proxyValidate?: (request: ProxyAgentRequest) => void
}
async function body(request: IncomingMessage): Promise<unknown> {
  let bytes = 0; const chunks: Buffer[] = []
  for await (const chunk of request) { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) throw new Error('Agent request exceeds its limit'); chunks.push(Buffer.from(chunk)) }
  return JSON.parse(Buffer.concat(chunks).toString()) as unknown
}
function json(response: ServerResponse, value: unknown): void { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)) }
export async function startAgentGateway(services: AgentGatewayServices, signal: AbortSignal) {
  const capability = randomBytes(32).toString('hex')
  const lifetime = new AbortController()
  const gatewaySignal = AbortSignal.any([signal, lifetime.signal])
  const pending = new Set<Promise<void>>()
  const proxyCalls = new Map<string, { controller: AbortController, drained: Promise<void> }>()
  // Keep cancelled identities for this gateway's lifetime so an early cancel cannot race a late request.
  const cancelledProxyCalls = new Set<string>()
  const callId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const received = Buffer.from(request.headers.authorization ?? '')
    const expected = Buffer.from(`Bearer ${capability}`)
    if (received.length !== expected.length || !timingSafeEqual(received, expected) || gatewaySignal.aborted || request.headers.origin) { response.statusCode = 403; json(response, { error: 'Run capability rejected' }); return }
    if (request.method !== 'POST' || !['/mcp', '/v1/responses', ...(services.model ? ['/v1/model'] : []), ...(services.proxy ? ['/v1/proxy', '/v1/proxy/cancel'] : []), ...(services.proxyValidate ? ['/v1/proxy/validate'] : [])].includes(request.url ?? '')) { response.statusCode = 405; json(response, { error: 'Unsupported agent endpoint' }); return }
    let operation: { controller: AbortController, drained: Promise<void> } | undefined
    let finishOperation: (() => void) | undefined
    const identity = request.headers['x-pod-agent-call']
    if (request.url === '/v1/proxy') {
      if (!callId(identity) || proxyCalls.has(identity) || cancelledProxyCalls.has(identity) || cancelledProxyCalls.size >= 10000) {
        response.statusCode = 409; json(response, { error: 'Proxy call identity rejected' }); return
      }
      operation = { controller: new AbortController(), drained: new Promise<void>((resolve) => { finishOperation = resolve }) }
      proxyCalls.set(identity, operation)
    }
    try {
      const closed = new AbortController()
      response.once('close', () => closed.abort(new Error('Agent connection closed')))
      const activeSignal = AbortSignal.any([gatewaySignal, closed.signal, ...(operation ? [operation.controller.signal] : [])])
      const abort = () => response.destroy()
      activeSignal.addEventListener('abort', abort, { once: true })
      response.once('close', () => activeSignal.removeEventListener('abort', abort))
      if (activeSignal.aborted) { response.destroy(); return }
      const value = await body(request)
      if (request.url === '/v1/proxy/cancel') {
        const id = value && typeof value === 'object' && !Array.isArray(value) ? (value as { id?: unknown }).id : undefined
        if (!callId(id)) { response.statusCode = 400; json(response, { error: 'Invalid proxy call identity' }); return }
        if (cancelledProxyCalls.size < 10000) cancelledProxyCalls.add(id)
        const active = proxyCalls.get(id)
        if (active) { active.controller.abort(new Error('Proxy call cancelled')); await active.drained }
        json(response, { drained: true }); return
      }
      if (request.url === '/v1/proxy/validate' && services.proxyValidate) {
        try {
          const parsed = parseAgentRequest(value)
          if (parsed.backend !== 'proxy') throw new AgentCallError('unsupported_combination', 'The proxy gateway requires an explicit proxy request', { phase: 'resolve' })
          services.proxyValidate(parsed)
          json(response, { valid: true })
        }
        catch (error) {
          const safe = error instanceof AgentCallError ? error : new AgentCallError('proxy_not_configured', 'Proxy validation failed', { phase: 'resolve' })
          response.statusCode = 400; json(response, { error: serializeSafeError(safe) })
        }
        return
      }
      if (request.url === '/v1/proxy' && services.proxy) {
        response.setHeader('Content-Type', 'application/x-ndjson')
        const send = (frame: unknown) => { if (!response.destroyed && !response.writableEnded) response.write(`${JSON.stringify(frame)}\n`) }
        try {
          const parsed = parseAgentRequest(value)
          if (parsed.backend !== 'proxy') throw new AgentCallError('unsupported_combination', 'The proxy gateway requires an explicit proxy request', { phase: 'resolve' })
          const result = await services.proxy(parsed, activeSignal, metadata => send({ type: 'metadata', metadata }))
          activeSignal.throwIfAborted()
          send({ type: 'complete', response: result.response, threadId: result.threadId })
        }
        catch (error) {
          const safe = error instanceof AgentCallError ? error : new AgentCallError(activeSignal.aborted ? 'cancelled' : 'provider_error', activeSignal.aborted ? 'Agent call cancelled' : 'Proxy gateway failed', { phase: 'request' })
          send({ type: 'error', error: serializeSafeError(safe), ...(safe.metadata ? { metadata: safe.metadata } : {}) })
        }
        response.end(); return
      }
      if (request.url === '/v1/model' && services.model) { json(response, { model: await services.model(activeSignal) }); return }
      if (request.url === '/v1/responses') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid provider request')
        const providerRequest = services.tool ? value : { ...value, tools: [], tool_choice: 'none', parallel_tool_calls: false }
        const upstream = await services.provider(providerRequest, activeSignal)
        response.statusCode = upstream.status; response.setHeader('Content-Type', upstream.headers.get('Content-Type') ?? 'text/event-stream')
        if (upstream.body) {
          const reader = upstream.body.getReader()
          const cancel = () => { void reader.cancel().catch((error: unknown) => response.destroy(error instanceof Error ? error : new Error('Provider stream cancellation failed'))) }
          activeSignal.addEventListener('abort', cancel, { once: true })
          let bytes = 0
          try {
            for (;;) {
              activeSignal.throwIfAborted()
              const next = await reader.read()
              if (next.done) break
              bytes += next.value.byteLength
              if (bytes > 16 * 1024 * 1024) throw new Error('Provider stream exceeds its 16 MiB limit')
              if (!response.write(next.value)) await once(response, 'drain', { signal: activeSignal })
            }
            activeSignal.throwIfAborted()
          }
          finally {
            activeSignal.removeEventListener('abort', cancel)
            try { await reader.cancel() }
            finally { reader.releaseLock() }
          }
        }
        response.end(); return
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid MCP request')
      const rpc = value as { jsonrpc?: string, id?: string | number, method?: string, params?: { name?: string, arguments?: unknown } }
      if (rpc.jsonrpc !== '2.0') throw new Error('Invalid MCP protocol')
      if (rpc.method === 'notifications/initialized' && rpc.id === undefined) { response.statusCode = 202; response.end(); return }
      if (typeof rpc.id !== 'string' && typeof rpc.id !== 'number') throw new Error('Invalid MCP request identity')
      let result: unknown
      if (rpc.method === 'initialize') {
        result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'OpenApe Pods', version: '1' } }
      }
      else if (rpc.method === 'ping') {
        result = {}
      }
      else if (rpc.method === 'tools/list') {
        result = { tools: services.tool ? [{ name: 'ape_shell', description: 'Invoke a granted read command of an assigned application using application and argv (or an explicit applicationId). Legacy tools use toolId instead. Authentication state stays inside the application sandbox.', inputSchema: { type: 'object', properties: { application: { type: 'string' }, applicationId: { type: 'string' }, toolId: { type: 'string' }, argv: { type: 'array', items: { type: 'string' } } }, required: ['argv'], oneOf: [{ required: ['application'] }, { required: ['applicationId'] }, { required: ['toolId'] }], additionalProperties: false } }] : [] }
      }
      else if (rpc.method === 'tools/call' && rpc.params?.name === 'ape_shell' && services.tool) {
        try {
          const text = JSON.stringify(await services.tool(rpc.params.arguments, activeSignal))
          if (Buffer.byteLength(text) > 256 * 1024) throw new Error('Tool reply exceeds its size limit')
          result = { content: [{ type: 'text', text }] }
        }
        catch (error) { result = { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Assigned tool call failed' }] } }
      }
      else { json(response, { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Only the assigned ape-shell tool is available' } }); return }
      json(response, { jsonrpc: '2.0', id: rpc.id, result })
    }
    finally {
      if (operation && callId(identity)) { proxyCalls.delete(identity); finishOperation?.() }
    }
  }
  const server = createServer((request, response) => {
    const work = handle(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy()
      }
      else { response.statusCode = 400; json(response, { error: error instanceof Error ? error.message : 'Agent gateway failed' }) }
    }).finally(() => { pending.delete(work) })
    pending.add(work)
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Agent gateway failed to bind')
  return { port: address.port, capability, close: async () => { lifetime.abort(new Error('Agent gateway closed')); server.closeAllConnections(); await Promise.allSettled([...pending]); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) } }
}
