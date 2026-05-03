// One ThreadSession per (room, thread). Owns a long-lived pi RPC
// subprocess, a queue of pending prompts, and the placeholder message
// id for the in-flight turn. Streams pi text deltas back into the chat
// by PATCHing the placeholder.
//
// Phase B: each chat thread is an isolated pi conversation. The bridge
// keeps one of these per (roomId, threadId) so the agent can hold
// parallel ChatGPT-style sessions with the same human contact without
// cross-contamination.

import type { ChatApi } from './chat-api'
import type { PiEvent, PiRpcSession } from './pi-rpc'
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
  pi: PiRpcSession
  /** Logger sink — bridge typically forwards to stderr. */
  log: (line: string) => void
}

export class ThreadSession {
  private active: ActiveTurn | undefined
  private queue: Array<{ body: string, replyToMessageId: string }> = []

  constructor(private deps: ThreadSessionDeps) {
    this.deps.pi.on(event => this.onPiEvent(event))
  }

  /** Forward an inbound chat message to pi. Queues if a turn is in flight. */
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
    this.deps.pi.prompt(body)
  }

  private onPiEvent(event: PiEvent): void {
    if (!this.active) return
    switch (event.type) {
      case 'message_update': {
        const inner = event.assistantMessageEvent
        if (!inner) break
        if (inner.type === 'text_delta' && typeof inner.delta === 'string') {
          this.active.accumulated += inner.delta
          this.active.throttle.schedule()
        }
        break
      }
      case 'agent_end':
        this.endTurn()
        break
      case 'response':
        if (event.success === false) {
          this.deps.log(`pi rpc error (room=${this.deps.roomId} thread=${this.deps.threadId}): ${event.error ?? 'unknown'}`)
          this.failTurn(`(pi rpc error: ${event.error ?? 'unknown'})`)
        }
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
