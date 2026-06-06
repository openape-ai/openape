import type { ResponsesEvent } from './responses-stream'
import type { ChatCompletionChunk, ChatCompletionsRequest, ResponsesBody } from './types'
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
