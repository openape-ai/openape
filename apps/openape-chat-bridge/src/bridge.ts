// openape-chat-bridge
//
// Long-running daemon. Connects to chat.openape.ai via WebSocket using
// the agent's IdP token. For each inbound message that wasn't sent by
// the agent itself, forwards into a long-lived pi RPC subprocess for
// the room. Streams pi's `text_delta` events back as progressive PATCH
// updates on a placeholder chat message — so the human sees the agent
// "type" in real time, with memory across messages in the same room.
//
// Env knobs (all optional):
//   APE_CHAT_ENDPOINT            override https://chat.openape.ai
//   APE_CHAT_BRIDGE_PI_BIN       pi binary path (default: 'pi' on PATH)
//   APE_CHAT_BRIDGE_PROVIDER     pi --provider (default: 'litellm')
//   APE_CHAT_BRIDGE_MODEL        pi --model    (default: 'gpt-5.4')
//   APE_CHAT_BRIDGE_ROOM         restrict to one room id

import process from 'node:process'
import { ensureFreshIdpAuth, NotLoggedInError } from '@openape/cli-auth'
import { decodeJwt } from 'jose'
import WebSocket from 'ws'
import { ChatApi } from './chat-api'
import { PiRpcSession } from './pi-rpc'
import { RoomSession } from './room-session'

const DEFAULT_ENDPOINT = 'https://chat.openape.ai'
const DEFAULT_PI_BIN = 'pi'
const DEFAULT_PROVIDER = 'litellm'
const DEFAULT_MODEL = 'gpt-5.4'

const PING_INTERVAL_MS = 30_000
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000

interface Message {
  id: string
  roomId: string
  senderEmail: string
  senderAct: 'human' | 'agent'
  body: string
  replyTo: string | null
  createdAt: number
  editedAt: number | null
}

interface WsFrame {
  type: string
  room_id: string
  payload: Record<string, unknown>
}

interface BridgeConfig {
  endpoint: string
  piBin: string
  provider: string
  model: string
  roomFilter?: string
}

function readConfig(): BridgeConfig {
  return {
    endpoint: (process.env.APE_CHAT_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/$/, ''),
    piBin: process.env.APE_CHAT_BRIDGE_PI_BIN ?? DEFAULT_PI_BIN,
    provider: process.env.APE_CHAT_BRIDGE_PROVIDER ?? DEFAULT_PROVIDER,
    model: process.env.APE_CHAT_BRIDGE_MODEL ?? DEFAULT_MODEL,
    roomFilter: process.env.APE_CHAT_BRIDGE_ROOM,
  }
}

async function getIdentity(): Promise<{ email: string }> {
  const idp = await ensureFreshIdpAuth()
  const claims = decodeJwt(idp.access_token) as { sub?: string }
  if (!claims.sub) {
    throw new NotLoggedInError('IdP token has no sub claim — re-run `apes login` for this user.')
  }
  return { email: claims.sub }
}

function log(line: string): void {
  process.stderr.write(`${new Date().toISOString()}  ${line}\n`)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

class Bridge {
  private rooms = new Map<string, RoomSession>()
  private chat: ChatApi
  private bearer: () => Promise<string>

  constructor(private cfg: BridgeConfig, private selfEmail: string) {
    this.bearer = async () => {
      const idp = await ensureFreshIdpAuth()
      return `Bearer ${idp.access_token}`
    }
    this.chat = new ChatApi(this.cfg.endpoint, this.bearer)
  }

  handleInbound(msg: Message): void {
    if (msg.senderEmail === this.selfEmail) return
    if (!msg.body.trim()) return
    if (this.cfg.roomFilter && msg.roomId !== this.cfg.roomFilter) return

    log(`[${msg.roomId}] in: ${truncate(msg.body, 80)}`)
    const session = this.getOrCreateRoom(msg.roomId)
    session.enqueue(msg.body, msg.id)
  }

  private getOrCreateRoom(roomId: string): RoomSession {
    let s = this.rooms.get(roomId)
    if (s) return s
    const pi = new PiRpcSession({
      binary: this.cfg.piBin,
      args: ['--provider', this.cfg.provider, '--model', this.cfg.model, '--no-session'],
    })
    pi.onExit((code) => {
      log(`[${roomId}] pi exited code=${code} — recreating on next message`)
      this.rooms.delete(roomId)
    })
    s = new RoomSession({
      roomId,
      chat: this.chat,
      pi,
      log,
    })
    this.rooms.set(roomId, s)
    return s
  }

  async pumpOnce(): Promise<void> {
    const bearer = await this.bearer()
    const wsUrl = `${this.cfg.endpoint.replace(/^http/, 'ws')}/api/ws?token=${encodeURIComponent(bearer.replace(/^Bearer\s+/i, ''))}`
    const ws = new WebSocket(wsUrl)
    return new Promise<void>((resolve, reject) => {
      let pingTimer: NodeJS.Timeout | undefined

      ws.on('open', () => {
        log(`connected as ${this.selfEmail} → ${this.cfg.endpoint}`)
        pingTimer = setInterval(() => ws.ping(), PING_INTERVAL_MS)
      })

      ws.on('message', (data: WebSocket.RawData) => {
        const text = typeof data === 'string'
          ? data
          : Buffer.isBuffer(data) ? data.toString('utf8') : ''
        if (!text) return
        let frame: WsFrame
        try { frame = JSON.parse(text) as WsFrame }
        catch { return }
        if (frame.type !== 'message') return
        this.handleInbound(frame.payload as unknown as Message)
      })

      ws.on('close', () => {
        if (pingTimer) clearInterval(pingTimer)
        resolve()
      })
      ws.on('error', (err: Error) => {
        if (pingTimer) clearInterval(pingTimer)
        reject(err)
      })
    })
  }
}

async function main(): Promise<void> {
  const cfg = readConfig()
  const identity = await getIdentity()

  log(`bridge starting — pi=${cfg.piBin} provider=${cfg.provider} model=${cfg.model} room=${cfg.roomFilter ?? '*'}`)

  const bridge = new Bridge(cfg, identity.email)
  let attempt = 0
  while (true) {
    try {
      await bridge.pumpOnce()
      attempt = 0
    }
    catch (err) {
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS)
      attempt++
      const msg = err instanceof Error ? err.message : String(err)
      log(`disconnected (${msg}) — reconnecting in ${Math.round(delay / 1000)}s`)
      await sleep(delay)
    }
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  process.stderr.write(`fatal: ${msg}\n`)
  process.exit(1)
})
