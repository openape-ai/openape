import type { ChatCompletionsRequest, ChatMessage, ResponsesBody, ResponsesInputItem, ResponsesTool } from './types'
import { sanitizeToolParameters } from './schema-sanitizer'

// Chat-Completions request → Codex Responses request body. Shapes per OpenClaw's
// `convertResponsesMessages` / `convertResponsesTools` / `buildRequestBody`:
// the system prompt is hoisted to `instructions` (never an input item), each
// role maps to a Responses input item, and tools lose the Chat-Completions
// `function` wrapper. `store:false` + `stream:true` are mandatory.

const DEFAULT_INSTRUCTIONS = 'You are a helpful assistant.'

function messageToInputItems(msg: ChatMessage): ResponsesInputItem[] {
  switch (msg.role) {
    case 'system':
    case 'developer':
      return [] // hoisted to `instructions`
    case 'user':
      return [{ role: 'user', content: [{ type: 'input_text', text: msg.content }] }]
    case 'assistant': {
      const items: ResponsesInputItem[] = []
      if (msg.content) {
        items.push({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: msg.content, annotations: [] }] })
      }
      for (const call of msg.tool_calls ?? []) {
        items.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments })
      }
      return items
    }
    case 'tool':
      return [{ type: 'function_call_output', call_id: msg.tool_call_id, output: msg.content }]
  }
}

export function chatCompletionsToResponsesBody(req: ChatCompletionsRequest): ResponsesBody {
  const systemText = req.messages
    .filter((m): m is Extract<ChatMessage, { role: 'system' | 'developer' }> => m.role === 'system' || m.role === 'developer')
    .map(m => m.content)
    .join('\n\n')

  const body: ResponsesBody = {
    model: req.model,
    store: false,
    stream: true,
    instructions: systemText || DEFAULT_INSTRUCTIONS,
    input: req.messages.flatMap(messageToInputItems),
    tool_choice: 'auto',
    parallel_tool_calls: true,
    text: { verbosity: 'low' },
    include: ['reasoning.encrypted_content'],
  }

  if (req.tools && req.tools.length > 0) {
    // Lift name/description/parameters out of the `function` wrapper; sort by
    // name so the prompt-cache key bytes are stable across turns.
    body.tools = req.tools
      .map((t): ResponsesTool => ({ type: 'function', name: t.function.name, description: t.function.description, parameters: sanitizeToolParameters(t.function.parameters ?? {}) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  return body
}
