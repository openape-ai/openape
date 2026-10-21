import { randomUUID } from 'node:crypto'
import type { ProxyAgentRequest } from '../../contracts/agent'
import { AgentCallError, serializeSafeError, safeSystemCause } from '../../contracts/agent-errors'
import type { SafeAgentError } from '../../contracts/agent-errors'
import { freezeAgentMetadata } from '../../contracts/agent-metadata'
import type { AgentCallMetadata } from '../../contracts/agent-metadata'
import { scriptFrameBytes } from '../runs/response'

export interface ProxyEndpoint { port: number, capability: string }
export type ProxyAgentCall = (request: ProxyAgentRequest, signal: AbortSignal, metadata: (value: AgentCallMetadata) => void) => Promise<{ response: string, threadId: string }>

export function assertProxyEndpoint(endpoint: ProxyEndpoint): void {
  if (!endpoint || !Number.isInteger(endpoint.port) || endpoint.port < 1024 || endpoint.port > 65535 || !/^[a-f0-9]{64}$/.test(endpoint.capability)) throw new Error('Invalid trusted proxy endpoint')
}

export function proxyAgentValidation(endpoint: ProxyEndpoint): (request: ProxyAgentRequest, signal: AbortSignal) => Promise<void> {
  assertProxyEndpoint(endpoint)
  return async (request, signal) => {
    const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/proxy/validate`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endpoint.capability}` }, body: JSON.stringify(request), signal })
    const reply = await response.json() as { valid?: boolean, error?: SafeAgentError }
    if (reply.error) throw new AgentCallError(reply.error.code, reply.error.message, reply.error.details)
    if (!response.ok || reply.valid !== true) throw new AgentCallError('invalid_response', 'Invalid proxy validation reply', { phase: 'validate', httpStatus: response.status })
  }
}

async function drainProxyCall(endpoint: ProxyEndpoint, id: string): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/proxy/cancel`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endpoint.capability}` }, body: JSON.stringify({ id }), signal: controller.signal })
    const reply = await response.json() as { drained?: boolean }
    if (!response.ok || reply.drained !== true) throw new Error('Cleanup acknowledgement missing')
  }
  catch { throw new AgentCallError('proxy_unreachable', 'Private proxy cleanup could not be confirmed', { phase: 'read', cause: 'proxy_cleanup_unconfirmed' }) }
  finally { clearTimeout(timer) }
}

/** Only the trusted host chooses the destination, credential and provider payload. */
export function proxyAgentCall(endpoint: ProxyEndpoint): ProxyAgentCall {
  assertProxyEndpoint(endpoint)
  return async (request, signal, event) => {
    const started = Date.now()
    const callId = randomUUID()
    let metadata: AgentCallMetadata = { callId, backend: 'proxy', provider: request.provider, modelSize: request.modelSize, modelId: null, reportedModelId: null, requestedThinking: request.thinking ?? null, effectiveThinking: null, wireThinking: null, configRevision: null, configHash: null, modelSelection: 'latest-family', startedAt: new Date(started).toISOString(), endedAt: null, durationMs: null, status: 'running', threadId: `proxy-call:${callId}` }
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(new AgentCallError('timeout', 'Proxy agent call timed out', { phase: 'read' })), request.timeoutSeconds * 1000)
    const active = AbortSignal.any([signal, deadline.signal])
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      active.throwIfAborted()
      const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/proxy`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endpoint.capability}`, 'X-Pod-Agent-Call': callId }, body: JSON.stringify(request), signal: active })
      if (!response.ok || !response.body) throw new AgentCallError('proxy_unreachable', 'Private proxy gateway is unavailable', { phase: 'connect', httpStatus: response.status })
      reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8', { fatal: true })
      let buffer = ''; let bytes = 0; let complete: { response: string, threadId: string } | undefined
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) { buffer += decoder.decode(); break }
        bytes += chunk.value.byteLength
        if (bytes > scriptFrameBytes + 64 * 1024) throw new AgentCallError('response_too_large', 'Private proxy response exceeds its limit', { phase: 'read' })
        buffer += decoder.decode(chunk.value, { stream: true })
        for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
          const frame = JSON.parse(buffer.slice(0, newline)) as { type?: string, metadata?: AgentCallMetadata, error?: SafeAgentError, response?: unknown, threadId?: unknown }
          buffer = buffer.slice(newline + 1)
          if (complete) throw new AgentCallError('invalid_response', 'Private proxy sent data after completion', { phase: 'validate' })
          if (frame.type === 'metadata' && frame.metadata?.backend === 'proxy') {
            metadata = freezeAgentMetadata(frame.metadata)
            if (metadata.status === 'running') event(metadata)
          }
          else if (frame.type === 'complete' && typeof frame.response === 'string' && typeof frame.threadId === 'string') {
            complete = { response: frame.response, threadId: frame.threadId }
          }
          else if (frame.type === 'error' && frame.error) {
            if (frame.metadata) metadata = freezeAgentMetadata(frame.metadata)
            throw new AgentCallError(frame.error.code, frame.error.message, frame.error.details)
          }
          else {
            throw new AgentCallError('invalid_response', 'Invalid private proxy response', { phase: 'validate' })
          }
        }
      }
      active.throwIfAborted()
      if (buffer || !complete || metadata.status !== 'completed') throw new AgentCallError('response_truncated', 'Private proxy response ended before completion', { phase: 'read' })
      event(metadata)
      return complete
    }
    catch (failure) {
      let error = active.aborted
        ? (deadline.signal.aborted && !signal.aborted ? deadline.signal.reason as AgentCallError : new AgentCallError('cancelled', 'Proxy agent call cancelled', { phase: 'read' }))
        : failure instanceof AgentCallError ? failure : failure instanceof SyntaxError || (failure instanceof TypeError && !safeSystemCause(failure)) ? new AgentCallError('invalid_response', 'Invalid private proxy response', { phase: 'validate' }) : new AgentCallError('proxy_unreachable', 'Private proxy connection failed', { phase: 'read', ...(safeSystemCause(failure) ? { cause: safeSystemCause(failure) } : {}) })
      if (reader) {
        try { await reader.cancel() }
        catch { /* The drain acknowledgement below confirms cleanup after a broken response. */ }
      }
      try { await drainProxyCall(endpoint, callId) }
      catch (cleanup) { error = cleanup as AgentCallError }
      const terminal = freezeAgentMetadata({ ...metadata, status: error.code === 'timeout' ? 'timeout' : error.code === 'cancelled' ? 'cancelled' : 'failed', endedAt: new Date().toISOString(), durationMs: Date.now() - Date.parse(metadata.startedAt), error: serializeSafeError(error) })
      error.metadata = terminal
      event(terminal)
      throw error
    }
    finally { clearTimeout(timer); reader?.releaseLock() }
  }
}
