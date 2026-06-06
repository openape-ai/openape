import type { ChatCompletionChunk, ChunkChoiceDelta } from './types'

// Codex Responses SSE events → OpenAI chat.completion.chunk(s). Stateful: the
// assistant role chunk is emitted once, and tool-call argument deltas are
// correlated back to their open tool-call by the event's `item_id`. Mapping per
// OpenClaw's `processResponsesStream` + the gateway's chunk serializers.

export interface ResponsesEvent {
  type: string
  item?: { id?: string, type?: string, call_id?: string, name?: string }
  item_id?: string
  delta?: string
  response?: { status?: string, error?: unknown }
}

export class ResponsesStreamConverter {
  private roleSent = false
  private toolIndexByItem = new Map<string, number>()
  private toolCallCount = 0
  private sawToolCall = false

  constructor(private readonly meta: { id: string, model: string, created: number }) {}

  private chunk(delta: ChunkChoiceDelta, finishReason: string | null = null): ChatCompletionChunk {
    return {
      id: this.meta.id,
      object: 'chat.completion.chunk',
      created: this.meta.created,
      model: this.meta.model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    }
  }

  private role(): ChatCompletionChunk[] {
    if (this.roleSent)
      return []
    this.roleSent = true
    return [this.chunk({ role: 'assistant' })]
  }

  push(event: ResponsesEvent): ChatCompletionChunk[] {
    switch (event.type) {
      case 'response.output_item.added': {
        const item = event.item
        if (item?.type === 'message')
          return this.role()
        if (item?.type === 'function_call') {
          const out = this.role()
          this.sawToolCall = true
          const index = this.toolCallCount++
          if (item.id)
            this.toolIndexByItem.set(item.id, index)
          out.push(this.chunk({ tool_calls: [{ index, id: item.call_id, type: 'function', function: { name: item.name, arguments: '' } }] }))
          return out
        }
        return [] // reasoning + other items have no Chat-Completions surface
      }
      case 'response.output_text.delta': {
        const out = this.role()
        out.push(this.chunk({ content: event.delta ?? '' }))
        return out
      }
      case 'response.function_call_arguments.delta': {
        const index = event.item_id !== undefined ? this.toolIndexByItem.get(event.item_id) : undefined
        if (index === undefined)
          return []
        return [this.chunk({ tool_calls: [{ index, function: { arguments: event.delta ?? '' } }] })]
      }
      case 'response.completed':
      case 'response.done':
      case 'response.incomplete': {
        const status = event.response?.status
        const finish = status === 'incomplete' ? 'length' : this.sawToolCall ? 'tool_calls' : 'stop'
        return [this.chunk({}, finish)]
      }
      case 'error':
      case 'response.failed':
        throw new Error(`codex responses stream error: ${JSON.stringify(event.response ?? event)}`)
      default:
        return []
    }
  }
}
