import type { ProxyAgentRequest } from '../../contracts/agent'
import { AgentCallError, safeSystemCause } from '../../contracts/agent-errors'
import type { AgentErrorCode, AgentPhase } from '../../contracts/agent-errors'
import type { AgentUsage } from '../../contracts/agent-metadata'
import type { ProxySnapshot } from './types'

export const proxyResponseBytes = 240 * 1024
interface ProxyReply { response: string, reportedModelId: string, upstreamId?: string, usage?: AgentUsage }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function failure(code: AgentErrorCode, message: string): never { throw new AgentCallError(code, message, { phase: 'validate' }) }
function identifier(value: unknown): string | undefined { return typeof value === 'string' && /^[a-z0-9][\w.:@+-]{0,159}$/i.test(value) ? value : undefined }

export function proxyPayload(snapshot: ProxySnapshot, request: ProxyAgentRequest): Record<string, unknown> {
  const common = { model: snapshot.model.modelId, messages: [{ role: 'user', content: request.prompt }], stream: false }
  const wire = snapshot.wireThinking
  if (snapshot.model.protocol === 'responses' && 'reasoning_effort' in wire) return { model: snapshot.model.modelId, input: [{ role: 'user', content: [{ type: 'input_text', text: request.prompt }] }], reasoning: { effort: wire.reasoning_effort }, stream: false, store: false, tools: [], tool_choice: 'none', max_output_tokens: snapshot.model.outputLimit }
  if (snapshot.model.protocol === 'chat-completions' && 'reasoning_effort' in wire) return { ...common, max_completion_tokens: snapshot.model.outputLimit, tools: [], tool_choice: 'none', reasoning_effort: wire.reasoning_effort }
  if ('type' in wire) return { ...common, max_tokens: snapshot.model.outputLimit, tool_choice: { type: 'none' }, fallbacks: [], thinking: wire.type === 'enabled' ? { type: 'enabled', budget_tokens: wire.budget_tokens } : { type: 'adaptive' }, ...(wire.type === 'adaptive' ? { output_config: { effort: wire.effort } } : {}) }
  throw new AgentCallError('unsupported_combination', 'Proxy thinking protocol does not match the configured model', { phase: 'resolve' })
}

function usage(value: unknown, protocol: ProxySnapshot['model']['protocol']): AgentUsage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = object(value)
  const result: AgentUsage = { source: protocol === 'messages' ? 'messages.usage' : protocol === 'responses' ? 'responses.usage' : 'chat-completions.usage', unit: 'tokens' }
  const fields: [keyof AgentUsage, unknown][] = protocol === 'messages'
    ? [['input', source.input_tokens], ['output', source.output_tokens], ['cacheRead', source.cache_read_input_tokens], ['cacheCreation', source.cache_creation_input_tokens]]
    : protocol === 'responses'
      ? [['input', source.input_tokens], ['output', source.output_tokens], ['total', source.total_tokens], ['reasoning', object(source.output_tokens_details).reasoning_tokens], ['cacheRead', object(source.input_tokens_details).cached_tokens]]
      : [['input', source.prompt_tokens], ['output', source.completion_tokens], ['total', source.total_tokens], ['reasoning', object(source.completion_tokens_details).reasoning_tokens], ['cacheRead', object(source.prompt_tokens_details).cached_tokens]]
  for (const [key, value] of fields) {
    if (Number.isSafeInteger(value) && (value as number) >= 0) Object.assign(result, { [key]: value })
  }
  return Object.keys(result).length > 2 ? result : undefined
}

function hasToolFields(value: Record<string, unknown>): boolean {
  return ['tool_calls', 'function_call', 'images', 'audio'].some(key => value[key] != null && (!Array.isArray(value[key]) || (value[key] as unknown[]).length > 0))
}
function completed(reason: unknown, protocol: 'messages' | 'chat-completions', native = false): void {
  if (['max_tokens', 'max_output_tokens', 'length', 'incomplete'].includes(String(reason))) failure('response_truncated', 'Proxy response stopped before completion')
  if (['tool_use', 'tool_calls', 'function_call'].includes(String(reason))) failure('unexpected_tool_call', 'Proxy response attempted tool execution')
  const allowed = native ? ['stop', 'end_turn', 'stop_sequence', 'completed'] : protocol === 'messages' ? ['end_turn', 'stop_sequence'] : ['stop']
  if (!allowed.includes(String(reason))) failure('invalid_response', 'Proxy response has no successful finish reason')
}

export function normalizeProxyResponse(value: unknown, snapshot: ProxySnapshot, identity?: (reportedModelId: string | null, upstreamId?: string) => void): ProxyReply {
  const reply = object(value)
  const reportedModelId = identifier(reply.model)
  const upstreamId = identifier(reply.id)
  identity?.(reportedModelId ?? null, upstreamId)
  if (!reportedModelId) failure('invalid_response', 'Proxy response is missing a valid model identity')
  if (reportedModelId !== snapshot.model.modelId) failure('model_mismatch', 'Proxy response model differs from the explicitly requested model')
  if (hasToolFields(reply)) failure('unexpected_tool_call', 'Proxy response contains a tool or nontext result')
  let response: string
  if (snapshot.model.protocol === 'messages') {
    if (reply.type !== 'message' || reply.role !== 'assistant' || !Array.isArray(reply.content)) failure('invalid_response', 'Proxy Messages response is malformed')
    completed(reply.stop_reason, 'messages')
    const text: string[] = []
    for (const block of reply.content) {
      const content = object(block)
      if (content.type === 'text' && typeof content.text === 'string') text.push(content.text)
      else if (content.type !== 'thinking' && content.type !== 'redacted_thinking') failure('unexpected_tool_call', 'Proxy Messages response contains a tool or nontext result')
    }
    response = text.join('')
  }
  else if (snapshot.model.protocol === 'responses') {
    if (reply.status === 'incomplete') failure('response_truncated', 'Responses output is incomplete')
    if (reply.status !== 'completed' || reply.error != null || !Array.isArray(reply.output)) failure('invalid_response', 'Responses output is not completed')
    const text: string[] = []
    for (const item of reply.output) {
      const output = object(item)
      if (output.type === 'reasoning') continue
      if (output.type !== 'message') failure('unexpected_tool_call', 'Responses output contains a tool or nontext item')
      if (output.role !== 'assistant' || output.status !== 'completed' || !Array.isArray(output.content)) failure('invalid_response', 'Responses assistant message is not completed')
      for (const block of output.content) {
        const content = object(block)
        if (content.type === 'refusal') failure('invalid_response', 'Responses request was refused')
        if (content.type !== 'output_text' || typeof content.text !== 'string') failure('unexpected_tool_call', 'Responses message contains nontext output')
        text.push(content.text)
      }
    }
    response = text.join('')
  }
  else {
    if (!Array.isArray(reply.choices) || reply.choices.length !== 1) failure('invalid_response', 'Proxy Chat Completions response requires one choice')
    const choice = object(reply.choices[0]); const message = object(choice.message)
    if (hasToolFields(choice) || hasToolFields(message)) failure('unexpected_tool_call', 'Proxy response contains a tool or nontext result')
    completed(choice.finish_reason, 'chat-completions')
    if (choice.native_finish_reason !== undefined) completed(choice.native_finish_reason, 'chat-completions', true)
    if (message.role !== 'assistant' || typeof message.content !== 'string') failure('invalid_response', 'Proxy response does not contain final assistant text')
    response = message.content
  }
  if (!response.trim()) failure('invalid_response', 'Proxy response contains no visible text')
  if (Buffer.byteLength(JSON.stringify({ response })) > proxyResponseBytes) failure('response_too_large', 'Proxy response exceeds the script result size limit')
  return { response, reportedModelId, ...(upstreamId ? { upstreamId } : {}), ...(usage(reply.usage, snapshot.model.protocol) ? { usage: usage(reply.usage, snapshot.model.protocol) } : {}) }
}

const knownProviderCodes = new Set(['authentication_error', 'invalid_api_key', 'auth_unavailable', 'no_auth_available', 'model_not_found', 'unsupported_model', 'rate_limit_exceeded', 'insufficient_quota', 'invalid_request_error', 'overloaded_error', 'server_error', 'thinking_not_supported'])
export function httpError(status: number, body: unknown, retryAfter: string | null): AgentCallError {
  const payload = object(object(body).error)
  const candidate = payload.code ?? payload.type
  const providerCode = typeof candidate === 'string' && knownProviderCodes.has(candidate) ? candidate : undefined
  let code: AgentErrorCode = 'provider_error'
  if (status === 401 || status === 403) code = 'proxy_unauthorized'
  else if (status === 429) code = 'rate_limited'
  else if (providerCode === 'model_not_found' || providerCode === 'unsupported_model') code = 'model_unavailable'
  else if (['authentication_error', 'invalid_api_key', 'auth_unavailable', 'no_auth_available'].includes(providerCode ?? '')) code = 'provider_authentication_failed'
  const safeRetry = retryAfter && /^(?:\d{1,9}|[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT)$/.test(retryAfter) ? retryAfter : undefined
  return new AgentCallError(code, `Proxy request failed (HTTP ${status}${providerCode ? `, ${providerCode}` : ''})`, { phase: 'request', httpStatus: status, ...(providerCode ? { providerCode } : {}), ...(safeRetry ? { retryAfter: safeRetry } : {}) })
}

export async function readBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new AgentCallError('invalid_response', 'Proxy response has no body', { phase: 'read' })
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0
  const abortRead = () => { void reader.cancel(signal.reason).catch(() => undefined) }
  signal.addEventListener('abort', abortRead, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > proxyResponseBytes) throw new AgentCallError('response_too_large', 'Proxy response exceeds its byte limit', { phase: 'read' })
      chunks.push(part.value)
    }
    signal.throwIfAborted()
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
    catch { throw new AgentCallError('invalid_response', 'Proxy response is not valid JSON', { phase: 'read' }) }
  }
  finally {
    signal.removeEventListener('abort', abortRead)
    try { await reader.cancel() }
    finally { reader.releaseLock() }
  }
}

export async function requestProxy(snapshot: ProxySnapshot, request: ProxyAgentRequest, key: string, signal: AbortSignal, fetcher: typeof fetch, identity?: (reportedModelId: string | null, upstreamId?: string) => void, onPhase?: (phase: AgentPhase) => void): Promise<ProxyReply> {
  let phase: AgentPhase = 'connect'
  try {
    signal.throwIfAborted()
    const endpoint = snapshot.model.protocol === 'chat-completions' ? 'chat/completions' : snapshot.model.protocol
    const response = await fetcher(`${snapshot.baseUrl}/${endpoint}`, { method: 'POST', headers: apiHeaders(snapshot.model.protocol, snapshot.authentication ?? 'token', key), body: JSON.stringify(proxyPayload(snapshot, request)), signal, redirect: 'manual' })
    phase = 'read'; onPhase?.(phase)
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new AgentCallError('proxy_unreachable', 'Proxy redirects are not permitted', { phase: 'request', httpStatus: response.status }) }
    let value: unknown
    try { value = await readBody(response, signal) }
    catch (error) { if (!response.ok && error instanceof AgentCallError && error.code === 'invalid_response') throw httpError(response.status, undefined, response.headers.get('retry-after')); throw error }
    if (!response.ok) throw httpError(response.status, value, response.headers.get('retry-after'))
    signal.throwIfAborted()
    phase = 'validate'; onPhase?.(phase)
    return normalizeProxyResponse(value, snapshot, identity)
  }
  catch (error) {
    if (signal.aborted) throw signal.reason
    if (error instanceof AgentCallError) throw error
    throw new AgentCallError('proxy_unreachable', 'Proxy connection failed', { phase, cause: safeSystemCause(error) })
  }
}

export function apiHeaders(protocol: ProxySnapshot['model']['protocol'], authentication: 'none' | 'token', key?: string): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(protocol === 'messages' ? { 'anthropic-version': '2023-06-01' } : {}) }
  if (authentication === 'token') {
    if (!key) throw new AgentCallError('credential_unavailable', 'An API token is required', { phase: 'resolve' })
    if (protocol === 'messages') headers['x-api-key'] = key
    else headers.authorization = `Bearer ${key}`
  }
  return headers
}
