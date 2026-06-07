// OpenAI Chat-Completions shapes (the subset @openape/agent-runtime sends) and
// the Codex Responses shapes we translate to/from. Text + tool calls only —
// images/reasoning are out of scope for the subscription proxy v1.

export interface ChatTool {
  type: 'function'
  function: { name: string, description?: string, parameters?: Record<string, unknown> }
}

export interface ChatToolCall {
  id: string
  type: 'function'
  function: { name: string, arguments: string }
}

export type ChatMessage =
  | { role: 'system' | 'developer', content: string }
  | { role: 'user', content: string }
  | { role: 'assistant', content?: string | null, tool_calls?: ChatToolCall[] }
  | { role: 'tool', tool_call_id: string, content: string }

export interface ChatCompletionsRequest {
  model: string
  messages: ChatMessage[]
  tools?: ChatTool[]
  stream?: boolean
}

// --- Codex Responses request body ---

export type ResponsesInputItem =
  | { role: 'user', content: Array<{ type: 'input_text', text: string }> }
  | { type: 'message', role: 'assistant', status: 'completed', content: Array<{ type: 'output_text', text: string, annotations: [] }> }
  | { type: 'function_call', call_id: string, name: string, arguments: string }
  | { type: 'function_call_output', call_id: string, output: string }

export interface ResponsesTool {
  type: 'function'
  name: string
  description?: string
  parameters: Record<string, unknown>
}

export interface ResponsesBody {
  model: string
  store: false
  stream: true
  instructions: string
  input: ResponsesInputItem[]
  tools?: ResponsesTool[]
  tool_choice: 'auto'
  parallel_tool_calls: true
  text: { verbosity: 'low' }
  include: ['reasoning.encrypted_content']
}

// --- chat.completion (non-streaming response, for `stream:false`) ---

export interface ChatCompletionMessage {
  role: 'assistant'
  content: string | null
  tool_calls?: ChatToolCall[]
}

export interface ChatCompletion {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: Array<{ index: 0, message: ChatCompletionMessage, finish_reason: string | null }>
}

// --- chat.completion.chunk (what the proxy streams back) ---

export interface ChunkToolCallDelta {
  index: number
  id?: string
  type?: 'function'
  function?: { name?: string, arguments?: string }
}

export interface ChunkChoiceDelta {
  role?: 'assistant'
  content?: string
  tool_calls?: ChunkToolCallDelta[]
}

export interface ChatCompletionChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: Array<{ index: 0, delta: ChunkChoiceDelta, finish_reason: string | null }>
}
