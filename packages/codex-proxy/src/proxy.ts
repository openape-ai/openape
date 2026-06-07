import type { ResponsesEvent } from './responses-stream'
import type { ChatCompletion, ChatCompletionChunk, ChatCompletionMessage, ChatCompletionsRequest, ChatToolCall, ResponsesBody } from './types'
import { chatCompletionsToResponsesBody } from './responses-request'
import { ResponsesStreamConverter } from './responses-stream'
import { parseSSEEvents } from './sse'

export interface ProxyDeps {
  meta: { id: string, model: string, created: number }
  /** POST the Codex Responses body and return the raw SSE text chunks. */
  fetchResponses: (body: ResponsesBody) => Promise<AsyncIterable<string>>
}

/**
 * Translate one Chat-Completions request into a Codex Responses call and stream
 * the response back as `chat.completion.chunk`s. Pure orchestration over the two
 * converters + an injected `fetchResponses` (the real one POSTs to the Codex
 * backend; tests inject a fake SSE stream).
 */
export async function* streamChatCompletion(req: ChatCompletionsRequest, deps: ProxyDeps): AsyncGenerator<ChatCompletionChunk> {
  const body = chatCompletionsToResponsesBody(req)
  const sse = await deps.fetchResponses(body)
  const converter = new ResponsesStreamConverter(deps.meta)
  for await (const event of parseSSEEvents(sse)) {
    for (const chunk of converter.push(event as ResponsesEvent))
      yield chunk
  }
}

/**
 * Drain the `chat.completion.chunk` stream into a single non-streaming
 * `chat.completion` — what an OpenAI client gets for `stream:false` (the
 * default). Concatenates text deltas and reassembles tool-call deltas by index.
 */
export async function collectChatCompletion(
  chunks: AsyncIterable<ChatCompletionChunk>,
  meta: { id: string, model: string, created: number },
): Promise<ChatCompletion> {
  let content = ''
  let finishReason: string | null = null
  const toolCalls: ChatToolCall[] = []

  for await (const chunk of chunks) {
    const choice = chunk.choices[0]
    if (!choice)
      continue
    if (choice.delta.content)
      content += choice.delta.content
    for (const delta of choice.delta.tool_calls ?? []) {
      const call = (toolCalls[delta.index] ??= { id: delta.id ?? '', type: 'function', function: { name: '', arguments: '' } })
      if (delta.id)
        call.id = delta.id
      if (delta.function?.name)
        call.function.name += delta.function.name
      if (delta.function?.arguments)
        call.function.arguments += delta.function.arguments
    }
    if (choice.finish_reason)
      finishReason = choice.finish_reason
  }

  const tool_calls = toolCalls.filter(Boolean)
  const message: ChatCompletionMessage = {
    role: 'assistant',
    content: content === '' && tool_calls.length > 0 ? null : content,
  }
  if (tool_calls.length > 0)
    message.tool_calls = tool_calls

  return {
    id: meta.id,
    object: 'chat.completion',
    created: meta.created,
    model: meta.model,
    choices: [{ index: 0, message, finish_reason: finishReason ?? 'stop' }],
  }
}
