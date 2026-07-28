import { asOpenAiTools, localToolName, wireToolName } from './agent-tools'
import type { ToolDefinition } from './agent-tools'

// Shared agent loop: send messages + tools to LiteLLM (OpenAI-
// compatible chat-completions API), execute any tool_calls in the
// response, append tool-result messages, loop until the model
// returns a response with no tool_calls or we hit max_steps.
//
// Both `apes agents run` (cron) and `apes agents serve --rpc`
// (chat-bridge subprocess) call into here so the LLM behaviour is
// guaranteed identical between modes.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  // Assistant message tool calls
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string, arguments: string }
  }>
  // Tool message metadata
  tool_call_id?: string
  name?: string
}

export interface RuntimeConfig {
  apiBase: string // LITELLM_BASE_URL (e.g. "http://127.0.0.1:4000/v1")
  apiKey: string // LITELLM_API_KEY
  model: string
  /**
   * Reasoning/thinking depth for models that support it (gpt-5.x via the
   * codex-proxy). Lets the PM-orchestrator tier compute by task difficulty —
   * `minimal`/`low` for quick wins, `high` for research/architecture — on the
   * same model. Omitted = the proxy/model default.
   */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
}

export interface TraceEntry {
  step: number
  type: 'assistant' | 'tool_call' | 'tool_result' | 'tool_error'
  // Stripped down for trace: don't carry full bodies
  preview: string
  tool?: string
}

export interface RunResult {
  status: 'ok' | 'error'
  finalMessage: string | null
  stepCount: number
  trace: TraceEntry[]
}

export interface RunStreamHandlers {
  onTextDelta?: (delta: string) => void
  onToolCall?: (call: { name: string, args: unknown }) => void
  onToolResult?: (result: { name: string, result: unknown }) => void
  onToolError?: (err: { name: string, error: string }) => void
  onDone?: (result: RunResult) => void
}

export interface RunOptions {
  config: RuntimeConfig
  systemPrompt: string
  userMessage: string
  tools: ToolDefinition[]
  maxSteps: number
  // Pre-existing message history for continued sessions (RPC mode).
  // The system prompt is always prepended, even if `history` is
  // non-empty — the SP-stored prompt is canonical. Defaults to []
  // (a fresh single-user-turn conversation).
  history?: ChatMessage[]
  handlers?: RunStreamHandlers
  // Test seam — replace fetch (we always use the global fetch in
  // production). Tests pass a mock that returns canned responses.
  fetchImpl?: typeof fetch
  /**
   * Send `stream: true` to the LiteLLM proxy and aggregate the SSE
   * chunks locally into a single non-stream response. Workaround for
   * LiteLLM's chatgpt-OAuth provider whose non-stream `/v1/chat/
   * completions` returns an empty body (the chatgpt upstream only
   * emits content via the responses-API streaming path; the bridge
   * back to chat/completions fails to aggregate). Streaming + local
   * aggregation produces a correct response with every provider
   * LiteLLM ships, so this flag is safe to enable globally — it
   * defaults off only to keep existing JSON-fixture tests intact.
   */
  streamAggregate?: boolean
}

interface OpenAIChoice {
  message: ChatMessage
  finish_reason?: string
}
interface OpenAIChatResponse {
  choices: OpenAIChoice[]
}

function previewJson(value: unknown, max = 500): string {
  let s: string
  try { s = JSON.stringify(value) }
  catch { s = String(value) }
  return s.length > max ? `${s.slice(0, max)}…` : s
}

// Stream aggregator — parses the SSE chunks LiteLLM emits when
// `stream:true` is set and folds them into the same OpenAIChatResponse
// shape the non-stream path returns. Handles two delta kinds:
//   - text content: simple concatenation
//   - tool_calls: keyed by `index`, the id arrives first, then the
//     function.name, then function.arguments piece by piece
// Used by the chatgpt-OAuth pod path (see RunOptions.streamAggregate).
async function aggregateChatStream(res: Response): Promise<OpenAIChatResponse> {
  if (!res.body) throw new Error('LiteLLM streaming response had no body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let content = ''
  const toolCalls = new Map<number, { id: string, type: 'function', function: { name: string, arguments: string } }>()
  let finishReason: string | undefined
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    while (true) {
      const nl = buf.indexOf('\n')
      if (nl === -1) break
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let chunk: { choices?: Array<{ delta?: { content?: string, tool_calls?: Array<{ index?: number, id?: string, function?: { name?: string, arguments?: string } }> }, finish_reason?: string }> }
      try { chunk = JSON.parse(payload) }
      catch { continue }
      const ch0 = chunk.choices?.[0]
      const delta = ch0?.delta
      if (delta?.content) content += delta.content
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          const existing = toolCalls.get(idx) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } }
          if (tc.id) existing.id = tc.id
          if (tc.function?.name) existing.function.name = tc.function.name
          if (tc.function?.arguments) existing.function.arguments += tc.function.arguments
          toolCalls.set(idx, existing)
        }
      }
      if (ch0?.finish_reason) finishReason = ch0.finish_reason
    }
  }
  const message: ChatMessage = { role: 'assistant', content: content || null }
  if (toolCalls.size > 0) message.tool_calls = Array.from(toolCalls.values())
  return { choices: [{ message, finish_reason: finishReason }] }
}

export async function runLoop(opts: RunOptions): Promise<RunResult> {
  const fetchFn = opts.fetchImpl ?? fetch
  const trace: TraceEntry[] = []
  const messages: ChatMessage[] = [
    { role: 'system', content: opts.systemPrompt },
    ...(opts.history ?? []),
    { role: 'user', content: opts.userMessage },
  ]
  const tools = asOpenAiTools(opts.tools)

  for (let step = 1; step <= opts.maxSteps; step++) {
    const requestBody = {
      model: opts.config.model,
      messages,
      ...(opts.config.reasoningEffort ? { reasoning_effort: opts.config.reasoningEffort } : {}),
      ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
      ...(opts.streamAggregate ? { stream: true } : {}),
    }
    const res = await fetchFn(`${opts.config.apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${opts.config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`LiteLLM ${res.status}: ${text.slice(0, 500)}`)
    }
    const data = opts.streamAggregate
      ? await aggregateChatStream(res)
      : await res.json() as OpenAIChatResponse
    const choice = data.choices?.[0]
    if (!choice) throw new Error('LiteLLM response had no choices')

    const assistant = choice.message
    messages.push(assistant)
    if (assistant.content) opts.handlers?.onTextDelta?.(assistant.content)

    trace.push({
      step,
      type: 'assistant',
      preview: previewJson({ content: assistant.content, tool_calls: assistant.tool_calls?.length ?? 0 }),
    })

    if (!assistant.tool_calls || assistant.tool_calls.length === 0) {
      const result: RunResult = {
        status: 'ok',
        finalMessage: assistant.content,
        stepCount: step,
        trace,
      }
      opts.handlers?.onDone?.(result)
      return result
    }

    // Execute each tool call; the model sees the result on the next turn.
    // Wire-format names (`time_now`) get decoded to local catalog names
    // (`time.now`) for lookup + handler events; we send back the same
    // wire name in the tool message so the next request validates.
    for (const call of assistant.tool_calls) {
      const wireName = call.function.name
      const localName = localToolName(wireName)
      const tool = opts.tools.find(t => t.name === localName)
      let parsedArgs: unknown
      try { parsedArgs = JSON.parse(call.function.arguments) }
      catch { parsedArgs = {} }
      opts.handlers?.onToolCall?.({ name: localName, args: parsedArgs })
      trace.push({ step, type: 'tool_call', tool: localName, preview: previewJson(parsedArgs) })

      let result: unknown
      let isError = false
      if (!tool) {
        result = `unknown tool: ${localName}`
        isError = true
      }
      else {
        try {
          result = await tool.execute(parsedArgs)
        }
        catch (err) {
          result = (err as Error)?.message ?? String(err)
          isError = true
        }
      }

      if (isError) {
        opts.handlers?.onToolError?.({ name: localName, error: String(result) })
        trace.push({ step, type: 'tool_error', tool: localName, preview: previewJson(result) })
      }
      else {
        opts.handlers?.onToolResult?.({ name: localName, result })
        trace.push({ step, type: 'tool_result', tool: localName, preview: previewJson(result) })
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: wireToolName(localName),
        content: typeof result === 'string' ? result : JSON.stringify(result),
      })
    }
  }

  // Loop fell through max_steps without a no-tool-calls reply.
  const result: RunResult = {
    status: 'error',
    finalMessage: `max_steps (${opts.maxSteps}) reached without completion`,
    stepCount: opts.maxSteps,
    trace,
  }
  opts.handlers?.onDone?.(result)
  return result
}

export interface RpcSession {
  messages: ChatMessage[]
  systemPrompt: string
  tools: ToolDefinition[]
  maxSteps: number
  lastTouched: number
}

const RPC_SESSION_TTL_MS = 60 * 60 * 1000

export class RpcSessionMap {
  private sessions = new Map<string, RpcSession>()

  get(id: string): RpcSession | undefined {
    const s = this.sessions.get(id)
    if (s) s.lastTouched = Date.now()
    return s
  }

  put(id: string, s: RpcSession): void {
    s.lastTouched = Date.now()
    this.sessions.set(id, s)
  }

  evictStale(): void {
    const cutoff = Date.now() - RPC_SESSION_TTL_MS
    for (const [k, v] of this.sessions) {
      if (v.lastTouched < cutoff) this.sessions.delete(k)
    }
  }

  size(): number {
    return this.sessions.size
  }
}
