import type { DecisionResult, Detector, InjectionConfig } from '@openape/prompt-injection-detector'
import type { BridgeConfig } from './bridge-config'
import { createDetector, decide, readInjectionConfig } from '@openape/prompt-injection-detector'

/**
 * A decoded inbound troop chat frame worth acting on: the chat it belongs to
 * plus the raw payload (`{id, chatId, role, body, ...}`). Produced by
 * {@link AgentSession.parseChatFrame} after the protocol envelope is stripped.
 */
export interface TroopChatFrame {
  chatId: string
  payload: Record<string, unknown>
}

/**
 * A troop chat message in the chat.openape.ai-style shape the agent loop
 * consumes — the input `runLoop` runs on. Produced by {@link AgentSession.toMessage}
 * from a {@link TroopChatFrame}.
 */
export interface TroopMessage {
  id: string
  roomId: string
  threadId: string
  senderEmail: string
  senderAct: 'human' | 'agent'
  body: string
  replyTo: string | null
  createdAt: number
  editedAt: number | null
}

export class AgentSession {
  /**
   * Lazily-created prompt-injection detector + threshold config, shared across
   * this session's messages. Matches the per-agent bridge, which builds one
   * `createDetector()` (LLM backend if configured, else heuristic) and reads
   * `readInjectionConfig()` once for its lifetime.
   */
  private injectionDetector: Detector | undefined
  private injectionConfig: InjectionConfig | undefined

  constructor(
    readonly email: string,
    readonly ownerEmail: string,
    readonly config: BridgeConfig,
  ) {}

  describe(): string {
    return `${this.email} (owner ${this.ownerEmail})`
  }

  /**
   * Build this agent's troop chat WebSocket URL from its resolved endpoint and
   * a bearer token. Ports the exact derivation the per-agent bridge uses in
   * `pumpOnce` (http→ws, token carried as a query param, a leading `Bearer `
   * prefix stripped, the value URL-encoded) so the nest's in-process WS-open
   * increment connects to the same socket the bridge process opens today — with
   * no second copy of the URL rule once the nest drives the connection.
   */
  chatSocketUrl(bearer: string): string {
    const base = this.config.endpoint.replace(/^http/, 'ws')
    const token = encodeURIComponent(bearer.replace(/^Bearer\s+/i, ''))
    return `${base}/_ws/chat?token=${token}`
  }

  /**
   * Decode one raw troop chat-socket frame into a {@link TroopChatFrame}, or
   * `null` for frames the agent ignores. Ports the exact decode + filter the
   * per-agent bridge applies in `pumpOnce`: tolerate string or `Buffer` data,
   * skip anything that is not valid JSON, and keep only `{type:'message'}`
   * frames that carry a payload. This is the canonical home for the framing
   * rule once the nest drives the connection — the WS-message increment routes
   * accepted frames into the agent loop with no second copy of the rule.
   */
  parseChatFrame(data: unknown): TroopChatFrame | null {
    const text = typeof data === 'string'
      ? data
      : Buffer.isBuffer(data) ? data.toString('utf8') : ''
    if (!text)
      return null
    let frame: { type?: string, chat_id?: string, payload?: Record<string, unknown> }
    try {
      frame = JSON.parse(text) as typeof frame
    }
    catch {
      return null
    }
    if (frame.type !== 'message' || !frame.payload)
      return null
    return { chatId: frame.chat_id ?? '', payload: frame.payload }
  }

  /**
   * Translate an accepted {@link TroopChatFrame} into the {@link TroopMessage}
   * the agent loop runs on. Ports the bridge's `translateTroopPayload`: troop's
   * payload carries `role` (human|agent) but no sender email, so the email is
   * synthesized from role (agent → this session's own email, human → the owner)
   * — the bridge skips its own echoes via `senderEmail === selfEmail`, so this
   * mapping must match. `threadId` is the synthetic `'main'` because troop has
   * no threads. This is the canonical home for the payload→message rule once the
   * nest drives the connection: the runLoop-dispatch increment feeds this
   * message straight into the loop with no second copy of the translation.
   */
  toMessage(frame: TroopChatFrame): TroopMessage {
    const { chatId, payload } = frame
    const role = payload.role === 'agent' ? 'agent' : 'human'
    return {
      id: String(payload.id ?? ''),
      roomId: chatId || String(payload.chatId ?? ''),
      threadId: 'main',
      senderEmail: role === 'agent' ? this.email : this.ownerEmail,
      senderAct: role,
      body: typeof payload.body === 'string' ? payload.body : '',
      replyTo: typeof payload.replyTo === 'string' ? payload.replyTo : null,
      createdAt: typeof payload.createdAt === 'number' ? payload.createdAt : Math.floor(Date.now() / 1000),
      editedAt: typeof payload.editedAt === 'number' ? payload.editedAt : null,
    }
  }

  /**
   * Whether a translated {@link TroopMessage} is this agent's own echo. troop
   * fans every chat message back to the socket that sent it, so the agent sees
   * its own replies; feeding those into the loop would be an infinite feedback
   * cycle. Ports the bridge's `handleInbound` guard (`senderEmail === selfEmail`)
   * — the canonical home for the self-echo rule once the nest drives the
   * connection: the runLoop-dispatch increment skips own echoes before it runs
   * the loop, with no second copy of the comparison.
   */
  isOwnEcho(message: TroopMessage): boolean {
    return message.senderEmail === this.email
  }

  /**
   * Whether a translated, non-echo {@link TroopMessage} should reach the agent
   * loop. Ports the bridge's remaining pre-loop guards in `handleInbound`: an
   * empty or whitespace-only body carries nothing to act on, and a configured
   * `roomFilter` scopes the agent to a single chat. (The bridge's `threadId`
   * guard is moot here — {@link toMessage} always synthesizes `'main'`.) The
   * own-echo guard stays {@link isOwnEcho}, applied first by the caller. This is
   * the canonical home for the dispatch-filter rule once the nest drives the
   * connection: the runLoop-dispatch increment runs the loop only for messages
   * this accepts, with no second copy of the guards.
   */
  shouldDispatch(message: TroopMessage): boolean {
    if (!message.body.trim())
      return false
    if (this.config.roomFilter && message.roomId !== this.config.roomFilter)
      return false
    return true
  }

  /**
   * Screen an accepted, non-echo {@link TroopMessage} for prompt injection
   * before it reaches the agent loop. Ports the bridge's `handleInbound`
   * choke-point: the bridge runs every inbound message through a heuristic
   * detector and refuses to forward it when the score crosses the threshold,
   * because once the text is in the loop's history a refusal is harder and
   * inconsistent. The owner gets a higher bar (legitimate "run shell, do X"
   * instructions aren't refused) — handled by `decide` keying the threshold off
   * `sender.isOwner`. This is the canonical home for the screening rule once the
   * nest drives the connection: the runLoop-dispatch increment refuses blocked
   * messages with no second copy of the detector setup or the sender mapping.
   */
  async screenInjection(message: TroopMessage): Promise<DecisionResult> {
    this.injectionDetector ??= createDetector()
    this.injectionConfig ??= readInjectionConfig()
    return decide(this.injectionDetector, {
      text: message.body,
      sender: {
        email: message.senderEmail,
        isOwner: message.senderEmail === this.ownerEmail,
      },
    }, {
      threshold: this.injectionConfig.threshold,
      ownerThreshold: this.injectionConfig.ownerThreshold,
    })
  }

  /**
   * The short, neutral refusal the agent posts back when {@link screenInjection}
   * blocks a message. Ports the bridge's `refusalText`: the matched reason is
   * appended so the owner sees in their chat history + audit log why a specific
   * message was blocked, but the phrasing deliberately avoids language an
   * attacker could copy back ("ignore previous instructions and …") to
   * re-trigger the detector. This is the canonical home for the refusal-message
   * rule once the nest drives the connection: the runLoop-dispatch increment
   * posts this text on a block with no second copy of the wording.
   */
  refusalText(reason: string | undefined): string {
    const base = 'I won\'t process this message — it looks like a prompt-injection attempt.'
    return reason ? `${base}\n\n(matched: ${reason})` : base
  }
}
