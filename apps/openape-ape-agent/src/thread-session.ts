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

import type { ChatMessage, RuntimeConfig } from '@openape/apes'
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
  /**
   * Resolve systemPrompt + tools at the start of every turn rather
   * than freezing them at construction. Lets owner edits in the
   * troop UI (which sync to `~/.openape/agent/agent.json` via
   * `apes agents sync`) take effect on the next message in an
   * existing thread — not just on freshly-opened threads.
   * `tools` is the string list that `taskTools()` resolves to the
   * concrete `ToolDefinition[]`.
   */
  resolveConfig: () => { systemPrompt: string, tools: string[] }
  maxSteps: number
  /** Logger sink — bridge typically forwards to stderr. */
  log: (line: string) => void
}

export class ThreadSession {
  private active: ActiveTurn | undefined
  private queue: Array<{ body: string, replyToMessageId: string }> = []
  private history: ChatMessage[] = []

  constructor(private deps: ThreadSessionDeps) {}

  /**
   * No-op placeholder kept for API compatibility with the previous
   *  RPC-listener model where dispose() detached the listener.
   */
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
    // Post an empty streaming placeholder. With streaming=true the
    // server accepts an empty body — clients render it as a typing
    // indicator instead of a literal "…". The first PATCH lands the
    // first chunk of LLM output; further patches keep streaming=true.
    const placeholder = await this.deps.chat.postMessage(this.deps.roomId, '', {
      replyTo: replyToMessageId,
      threadId: this.deps.threadId,
      streaming: true,
    })
    const turn: ActiveTurn = {
      placeholderId: placeholder.id,
      accumulated: '',
      replyToMessageId,
      throttle: createThrottle(async () => {
        if (!this.active || this.active.placeholderId !== placeholder.id) return
        const text = this.active.accumulated
        // Empty-body ticks during streaming would be no-ops on the
        // server. Wait until the first token arrives before the first
        // PATCH so the UI can keep showing the typing-indicator.
        if (text.length === 0) return
        try {
          await this.deps.chat.patchMessage(placeholder.id, { body: text })
        }
        catch (err) {
          this.deps.log(`patch failed (room=${this.deps.roomId} thread=${this.deps.threadId}): ${err instanceof Error ? err.message : String(err)}`)
        }
      }, PATCH_INTERVAL_MS),
    }
    this.active = turn

    // Pretty status labels for the tool-call subtitle. The wrench
    // emoji nudges the UI to render a status-with-icon row under the
    // typing cursor — e.g. "🔧 time.now". Strings short enough to fit
    // alongside the cursor on a phone (~30 chars max).
    const setStatus = async (status: string | null): Promise<void> => {
      try { await this.deps.chat.patchMessage(placeholder.id, { streamingStatus: status }) }
      catch (err) {
        this.deps.log(`status patch failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Run the agent loop in-process. Same code path the legacy
    // `apes agents serve --rpc` subprocess used; we just call it
    // directly instead of marshaling through stdio.
    //
    // Resolve config NOW (not at construction) so a troop-UI edit
    // that synced after this thread opened still takes effect on
    // this very turn — without dropping the message history.
    const { systemPrompt, tools } = this.deps.resolveConfig()
    try {
      const result = await runLoop({
        config: this.deps.runtimeConfig,
        systemPrompt,
        userMessage: body,
        tools: taskTools(tools),
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
            void setStatus(`🔧 ${name}`)
          },
          onToolResult: ({ name }) => {
            this.deps.log(`[${this.deps.roomId}/${this.deps.threadId.slice(0, 8)}] tool_result: ${name}`)
            void setStatus(null)
          },
          onToolError: ({ name, error }: { name: string, error: string }) => {
            this.deps.log(`[${this.deps.roomId}/${this.deps.threadId.slice(0, 8)}] tool_error: ${name} → ${error}`)
            void setStatus(null)
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
      await this.endTurn()
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.deps.log(`runtime error (room=${this.deps.roomId} thread=${this.deps.threadId}): ${message}`)
      await this.failTurn(`(runtime error: ${message})`)
    }
  }

  /**
   * Stream-end: flush any pending throttled body PATCH, then mark the
   * message as no-longer-streaming. The combined call also triggers
   * the user-facing push (the placeholder POST suppressed it).
   */
  private async endTurn(): Promise<void> {
    const turn = this.active
    if (!turn) return
    turn.throttle.flush()
    try {
      await this.deps.chat.patchMessage(turn.placeholderId, {
        body: turn.accumulated || '(empty response)',
        streaming: false,
        streamingStatus: null,
      })
    }
    catch (err) {
      this.deps.log(`stream-end patch failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    this.active = undefined
    const next = this.queue.shift()
    if (next) {
      void this.startTurn(next.body, next.replyToMessageId)
    }
  }

  private async failTurn(message: string): Promise<void> {
    const turn = this.active
    if (!turn) return
    turn.accumulated = message
    turn.throttle.flush()
    try {
      await this.deps.chat.patchMessage(turn.placeholderId, {
        body: message,
        streaming: false,
        streamingStatus: null,
      })
    }
    catch (err) {
      this.deps.log(`fail-turn patch failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    this.active = undefined
    const next = this.queue.shift()
    if (next) {
      void this.startTurn(next.body, next.replyToMessageId)
    }
  }
}
