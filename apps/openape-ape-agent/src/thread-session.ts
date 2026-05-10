// One ThreadSession per (room, thread). Maintains per-thread chat
// history + a placeholder message id for the in-flight turn. Calls
// the agent runtime in-process (no stdio JSON-RPC subprocess) and
// streams text deltas back into the chat by PATCHing the placeholder.
//
// Phase A simplification (#sim-arch): the bridge used to spawn one
// long-lived `apes agents serve --rpc` subprocess and dispatch turns
// via stdio JSON-RPC. We now import `runLoop` from @openape/apes
// directly. Same loop, no IPC overhead, no second process to keep
// alive. Per-thread message history that used to live in the
// subprocess's RpcSessionMap now lives on the ThreadSession itself.

import type { ChatMessage, RuntimeConfig, ToolDefinition } from '@openape/apes'
import { runLoop, taskTools } from '@openape/apes'
import type { ChatApi } from './chat-api'
import type { Throttle } from './throttle'
import { createThrottle } from './throttle'

const PATCH_INTERVAL_MS = 300

interface ActiveTurn {
  placeholderId: string
  accumulated: string
  throttle: Throttle
  replyToMessageId: string
}

export interface ThreadSessionDeps {
  roomId: string
  threadId: string
  chat: ChatApi
  /** LiteLLM proxy + model — the bridge resolves these from its env. */
  runtimeConfig: RuntimeConfig
  systemPrompt: string
  tools: string[]
  maxSteps: number
  /** Logger sink — bridge typically forwards to stderr. */
  log: (line: string) => void
}

export class ThreadSession {
  private active: ActiveTurn | undefined
  private queue: Array<{ body: string, replyToMessageId: string }> = []
  private history: ChatMessage[] = []
  private resolvedTools: ToolDefinition[]

  constructor(private deps: ThreadSessionDeps) {
    this.resolvedTools = taskTools(deps.tools)
  }

  /** No-op placeholder kept for API compatibility with the previous
   *  RPC-listener model where dispose() detached the listener. */
  dispose(): void {}

  /** Forward an inbound chat message to the runtime. Queues if a turn is in flight. */
  enqueue(body: string, replyToMessageId: string): void {
    if (this.active) {
      this.queue.push({ body, replyToMessageId })
      return
    }
    void this.startTurn(body, replyToMessageId)
  }

  private async startTurn(body: string, replyToMessageId: string): Promise<void> {
    const placeholder = await this.deps.chat.postMessage(this.deps.roomId, '…', {
      replyTo: replyToMessageId,
      threadId: this.deps.threadId,
    })
    const turn: ActiveTurn = {
      placeholderId: placeholder.id,
      accumulated: '',
      replyToMessageId,
      throttle: createThrottle(async () => {
        if (!this.active || this.active.placeholderId !== placeholder.id) return
        const text = this.active.accumulated || '…'
        try {
          await this.deps.chat.patchMessage(placeholder.id, text)
        }
        catch (err) {
          this.deps.log(`patch failed (room=${this.deps.roomId} thread=${this.deps.threadId}): ${err instanceof Error ? err.message : String(err)}`)
        }
      }, PATCH_INTERVAL_MS),
    }
    this.active = turn

    // Run the agent loop in-process. Same code path the legacy
    // `apes agents serve --rpc` subprocess used; we just call it
    // directly instead of marshaling through stdio.
    try {
      const result = await runLoop({
        config: this.deps.runtimeConfig,
        systemPrompt: this.deps.systemPrompt,
        userMessage: body,
        tools: this.resolvedTools,
        maxSteps: this.deps.maxSteps,
        history: this.history,
        handlers: {
          onTextDelta: (delta) => {
            if (!this.active) return
            this.active.accumulated += delta
            this.active.throttle.schedule()
          },
          onToolCall: ({ name }) => {
            this.deps.log(`[${this.deps.roomId}/${this.deps.threadId.slice(0, 8)}] tool_call: ${name}`)
          },
          onToolResult: ({ name }) => {
            this.deps.log(`[${this.deps.roomId}/${this.deps.threadId.slice(0, 8)}] tool_result: ${name}`)
          },
          onToolError: ({ name, error }) => {
            this.deps.log(`[${this.deps.roomId}/${this.deps.threadId.slice(0, 8)}] tool_error: ${name} → ${error}`)
          },
        },
      })

      // Persist this turn into the thread's message history so the
      // next turn has full context — same shape as the old runtime's
      // RpcSession.messages list.
      this.history.push({ role: 'user', content: body })
      if (result.finalMessage) {
        this.history.push({ role: 'assistant', content: result.finalMessage })
      }

      if (result.status === 'error') {
        this.deps.log(`runtime done with status=error (room=${this.deps.roomId} thread=${this.deps.threadId})`)
      }
      this.endTurn()
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.deps.log(`runtime error (room=${this.deps.roomId} thread=${this.deps.threadId}): ${message}`)
      this.failTurn(`(runtime error: ${message})`)
    }
  }

  private endTurn(): void {
    const turn = this.active
    if (!turn) return
    turn.throttle.flush()
    this.active = undefined
    const next = this.queue.shift()
    if (next) {
      void this.startTurn(next.body, next.replyToMessageId)
    }
  }

  private failTurn(message: string): void {
    const turn = this.active
    if (!turn) return
    turn.accumulated = message
    turn.throttle.flush()
    this.active = undefined
    const next = this.queue.shift()
    if (next) {
      void this.startTurn(next.body, next.replyToMessageId)
    }
  }
}
