import type { BridgeConfig } from './bridge-config'

/**
 * A decoded inbound troop chat frame worth acting on: the chat it belongs to
 * plus the raw payload (`{id, chatId, role, body, ...}`). Produced by
 * {@link AgentSession.parseChatFrame} after the protocol envelope is stripped.
 */
export interface TroopChatFrame {
  chatId: string
  payload: Record<string, unknown>
}

export class AgentSession {
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
}
