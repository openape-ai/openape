import { asOpenAiTools  } from './agent-tools'
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
  apiKey: string // LITELLM_API_KEY (or LITELLM_MASTER_KEY)
  model: string
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
    const res = await fetchFn(`${opts.config.apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${opts.config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: opts.config.model,
        messages,
        ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`LiteLLM ${res.status}: ${text.slice(0, 500)}`)
    }
    const data = await res.json() as OpenAIChatResponse
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
    for (const call of assistant.tool_calls) {
      const tool = opts.tools.find(t => t.name === call.function.name)
      let parsedArgs: unknown
      try { parsedArgs = JSON.parse(call.function.arguments) }
      catch { parsedArgs = {} }
      opts.handlers?.onToolCall?.({ name: call.function.name, args: parsedArgs })
      trace.push({ step, type: 'tool_call', tool: call.function.name, preview: previewJson(parsedArgs) })

      let result: unknown
      let isError = false
      if (!tool) {
        result = `unknown tool: ${call.function.name}`
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
        opts.handlers?.onToolError?.({ name: call.function.name, error: String(result) })
        trace.push({ step, type: 'tool_error', tool: call.function.name, preview: previewJson(result) })
      }
      else {
        opts.handlers?.onToolResult?.({ name: call.function.name, result })
        trace.push({ step, type: 'tool_result', tool: call.function.name, preview: previewJson(result) })
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
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
