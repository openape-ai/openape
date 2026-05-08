// One ThreadSession per (room, thread). Owns a long-lived
// `apes agents serve --rpc` subprocess (shared via the bridge), a
// queue of pending prompts, and the placeholder message id for the
// in-flight turn. Streams runtime text deltas back into the chat by
// PATCHing the placeholder.
//
// Phase B: each chat thread is an isolated runtime conversation. The
// bridge keeps one of these per (roomId, threadId) so the agent can
// hold parallel ChatGPT-style sessions with the same human contact
// without cross-contamination.
//
// M8: switched from pi --mode rpc to apes agents serve --rpc. The
// subprocess is now owned by the bridge, not per-thread, because the
// runtime keeps independent in-memory sessions keyed by session_id.

import type { ApesEvent, ApesRpcSession } from './apes-rpc'
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
  rpc: ApesRpcSession
  /** Wire format `${roomId}:${threadId}` — keeps runtime sessions isolated. */
  sessionId: string
  systemPrompt: string
  tools: string[]
  maxSteps: number
  model: string
  /** Logger sink — bridge typically forwards to stderr. */
  log: (line: string) => void
}

export class ThreadSession {
  private active: ActiveTurn | undefined
  private queue: Array<{ body: string, replyToMessageId: string }> = []
  private detach: (() => void) | undefined

  constructor(private deps: ThreadSessionDeps) {
    this.detach = this.deps.rpc.on(event => this.onRpcEvent(event))
  }

  /** Stop listening to the shared RPC stream — call when evicting the thread. */
  dispose(): void {
    this.detach?.()
    this.detach = undefined
  }

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
    this.deps.rpc.prompt({
      sessionId: this.deps.sessionId,
      systemPrompt: this.deps.systemPrompt,
      tools: this.deps.tools,
      maxSteps: this.deps.maxSteps,
      model: this.deps.model,
      userMsg: body,
    })
  }

  /**
   * Demultiplex by `session_id` — the bridge shares one runtime
   * subprocess across all threads, so we ignore events for other
   * sessions. Events without a session_id (legacy/error frames) are
   * also routed by best-effort to the active turn.
   */
  private onRpcEvent(event: ApesEvent): void {
    if (event.session_id && event.session_id !== this.deps.sessionId) return
    if (!this.active) return
    switch (event.type) {
      case 'text_delta':
        if (typeof event.delta === 'string') {
          this.active.accumulated += event.delta
          this.active.throttle.schedule()
        }
        break
      case 'done':
        if (event.status === 'error') {
          // Runtime hit max-steps or upstream model failure but still
          // emitted any partial text — flush as-is and log.
          this.deps.log(`runtime done with status=error (room=${this.deps.roomId} thread=${this.deps.threadId})`)
        }
        this.endTurn()
        break
      case 'error':
        this.deps.log(`runtime error (room=${this.deps.roomId} thread=${this.deps.threadId}): ${event.message ?? 'unknown'}`)
        this.failTurn(`(runtime error: ${event.message ?? 'unknown'})`)
        break
      case 'tool_call':
      case 'tool_result':
      case 'tool_error':
        // Tool events are informational — surface in the bridge log
        // for now; the chat UI can grow tool-call rendering later.
        this.deps.log(`[${this.deps.roomId}/${this.deps.threadId.slice(0, 8)}] ${event.type}: ${event.name ?? '?'}`)
        break
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
