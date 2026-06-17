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
import type { ChatBackend } from './troop-chat-api'
import type { Throttle } from './throttle'
import { createThrottle } from './throttle'

const PATCH_INTERVAL_MS = 300

// If the model backend produces no first token or tool-call within this
// window, the turn fails *visibly* instead of leaving the chat stuck on
// the typing indicator forever. Targets a hung/unreachable LLM proxy
// (e.g. expired upstream auth) — the exact failure that otherwise shows
// as an opaque, permanent "…". Disarmed on first activity, so a long but
// legitimately slow answer is never cut off.
const NO_ACTIVITY_TIMEOUT_MS = 60_000
const NO_RESPONSE_MESSAGE = '(no response from the model backend — it may be unavailable or its API auth expired; nothing was changed, please retry)'

interface ActiveTurn {
  placeholderId: string
  accumulated: string
  throttle: Throttle
  replyToMessageId: string
}

export interface ThreadSessionDeps {
  roomId: string
  threadId: string
  chat: ChatBackend
  /** LiteLLM proxy + model — the bridge resolves these from its env. */
  runtimeConfig: RuntimeConfig
  /**
   * Resolve the runtimeConfig fresh at the start of every turn. The gateway
   * bearer is a short-lived (1h) DDISA-exchanged token; a long-lived thread
   * that froze it at construction would present an expired token and get a
   * 401. When provided, this is awaited per turn so the token stays fresh;
   * falls back to the static `runtimeConfig` when absent (tests).
   */
  refreshRuntimeConfig?: () => Promise<RuntimeConfig>
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
  /**
   * Agent's own DDISA email — used to classify backfilled messages:
   * `senderEmail === selfEmail` → role='assistant', else → 'user'.
   */
  selfEmail: string
  maxSteps: number
  /** Logger sink — bridge typically forwards to stderr. */
  log: (line: string) => void
}

export class ThreadSession {
  private active: ActiveTurn | undefined
  private queue: Array<{ body: string, replyToMessageId: string }> = []
  private history: ChatMessage[] = []
  /**
   * Whether we've already backfilled history from the chat server.
   * Done lazily on the first turn so a freshly-created ThreadSession
   * (e.g. after a bridge restart) sees the full conversation context,
   * not just the message that woke it up. We skip the message that
   * triggered the turn — runLoop adds it via `userMessage`.
   */
  private backfilled = false

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

    // Resolve the runtimeConfig (gateway bearer) fresh per turn — the token
    // is short-lived, so a frozen one on a long-lived thread expires (401).
    const runtimeConfig = this.deps.refreshRuntimeConfig
      ? await this.deps.refreshRuntimeConfig()
      : this.deps.runtimeConfig

    // Backfill history from the chat server on the first turn after
    // this ThreadSession was created. Without this the agent only
    // remembers messages received via WS since the bridge process
    // booted — a restart wipes context. Done after posting the
    // placeholder (so the user immediately sees the typing indicator)
    // and before runLoop (so it gets the full context).
    await this.backfillHistoryOnce(replyToMessageId, body)

    // Watchdog: a hung backend makes `runLoop` await a response that
    // never arrives; without this the turn sits on the typing indicator
    // forever. `settleOnce` ensures exactly one of {watchdog, runLoop
    // result, runLoop throw} handles the turn — the others no-op.
    let sawActivity = false
    let turnSettled = false
    const settleOnce = (): boolean => {
      if (turnSettled) return true
      turnSettled = true
      return false
    }
    const watchdog = setTimeout(() => {
      if (sawActivity || this.active !== turn || settleOnce()) return
      this.deps.log(`turn watchdog: no model activity in ${NO_ACTIVITY_TIMEOUT_MS}ms — failing turn (room=${this.deps.roomId} thread=${this.deps.threadId})`)
      void this.failTurn(NO_RESPONSE_MESSAGE)
    }, NO_ACTIVITY_TIMEOUT_MS)

    try {
      const result = await runLoop({
        config: runtimeConfig,
        systemPrompt,
        userMessage: body,
        tools: taskTools(tools),
        maxSteps: this.deps.maxSteps,
        history: this.history,
        handlers: {
          onTextDelta: (delta) => {
            sawActivity = true
            if (!this.active) return
            this.active.accumulated += delta
            this.active.throttle.schedule()
          },
          onToolCall: ({ name }: { name: string }) => {
            sawActivity = true
            this.deps.log(`[${this.deps.roomId}/${this.deps.threadId.slice(0, 8)}] tool_call: ${name}`)
            void setStatus(`🔧 ${name}`)
          },
          onToolResult: ({ name }: { name: string }) => {
            this.deps.log(`[${this.deps.roomId}/${this.deps.threadId.slice(0, 8)}] tool_result: ${name}`)
            void setStatus(null)
          },
          onToolError: ({ name, error }: { name: string, error: string }) => {
            this.deps.log(`[${this.deps.roomId}/${this.deps.threadId.slice(0, 8)}] tool_error: ${name} → ${error}`)
            void setStatus(null)
          },
        },
      })
      clearTimeout(watchdog)
      if (settleOnce()) return // watchdog already failed this turn

      // Persist this turn into the thread's message history so the
      // next turn has full context — same shape as the old runtime's
      // RpcSession.messages list.
      this.history.push({ role: 'user', content: body })
      if (result.finalMessage) {
        this.history.push({ role: 'assistant', content: result.finalMessage })
      }

      if (result.status === 'error') {
        this.deps.log(`runtime done with status=error (room=${this.deps.roomId} thread=${this.deps.threadId})`)
        // Don't leave the user with a blank "(empty response)" when the
        // run errored without producing any text — surface it instead.
        if (!turn.accumulated) {
          await this.failTurn('(the model run ended with an error and produced no output — please retry)')
          return
        }
      }
      await this.endTurn()
    }
    catch (err) {
      clearTimeout(watchdog)
      if (settleOnce()) return // watchdog already failed this turn
      const message = err instanceof Error ? err.message : String(err)
      this.deps.log(`runtime error (room=${this.deps.roomId} thread=${this.deps.threadId}): ${message}`)
      await this.failTurn(`(runtime error: ${message})`)
    }
  }

  /**
   * Fetch recent chat history for this thread and seed `this.history`.
   * Idempotent — only runs once per ThreadSession instance. Skips the
   * placeholder we just posted plus the inbound message that triggered
   * this turn (runLoop's `userMessage` handles that one).
   *
   * Failures are non-fatal: we log and continue with empty history.
   * That preserves the pre-backfill behaviour rather than failing the
   * turn over a transient chat-server hiccup.
   */
  private async backfillHistoryOnce(currentMessageId: string, currentBody: string): Promise<void> {
    if (this.backfilled) return
    this.backfilled = true
    try {
      const rows = await this.deps.chat.listMessages(this.deps.roomId, this.deps.threadId, 50)
      // The list returns oldest-first. Drop:
      //   - the current inbound message (runLoop adds it via userMessage)
      //   - our own placeholder (empty body, streaming=true, just posted)
      //   - any other empty body (cron task placeholders mid-stream)
      for (const row of rows) {
        if (row.id === currentMessageId) continue
        if (!row.body || row.body.length === 0) continue
        if (row.body === currentBody && row.senderEmail !== this.deps.selfEmail) continue
        const role: ChatMessage['role'] = row.senderEmail === this.deps.selfEmail ? 'assistant' : 'user'
        this.history.push({ role, content: row.body })
      }
      this.deps.log(`[${this.deps.roomId}/${this.deps.threadId.slice(0, 8)}] backfilled ${this.history.length} message(s) from chat history`)
    }
    catch (err) {
      this.deps.log(`[${this.deps.roomId}/${this.deps.threadId.slice(0, 8)}] backfill failed (continuing with empty history): ${err instanceof Error ? err.message : String(err)}`)
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
