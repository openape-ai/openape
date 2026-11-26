import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { parseAgentRequest } from '../../contracts/agent'
import type { ProxyAgentRequest } from '../../contracts/agent'
import type { AgentCallMetadata } from '../../contracts/agent-metadata'
import { AgentCallError, serializeSafeError } from '../../contracts/agent-errors'

export interface AgentGatewayServices {
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
    if (request.method !== 'POST' || ![...(services.proxy ? ['/v1/proxy', '/v1/proxy/cancel'] : []), ...(services.proxyValidate ? ['/v1/proxy/validate'] : [])].includes(request.url ?? '')) { response.statusCode = 405; json(response, { error: 'Unsupported agent endpoint' }); return }
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
      throw new Error('Unsupported agent endpoint')
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
