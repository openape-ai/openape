// openape-chat-bridge
//
// Long-running daemon. Connects to chat.openape.ai via WebSocket using
// the agent's IdP token. For each inbound message that wasn't sent by
// the agent itself, forwards into a long-lived `apes agents serve --rpc`
// subprocess. Streams text_delta events back as progressive PATCH
// updates on a placeholder chat message — so the human sees the agent
// "type" in real time, with memory across messages in the same thread.
//
// M8: replaced the per-thread `pi --mode rpc` subprocess with a single
// shared `apes agents serve --rpc` runtime that multiplexes sessions
// via the `session_id` field. Tools, system prompt, model, max_steps
// are now per-message instead of per-process flags.
//
// System-prompt source: ~/.openape/agent/agent.json — populated by
// `apes agents sync` from the troop SP. Re-read per inbound message
// so owner-side edits via troop UI propagate within one sync cycle
// (~5min) without restarting the daemon. Env var below is the
// boot-time fallback when the file isn't there yet.
//
// Env knobs (all optional):
//   APE_CHAT_ENDPOINT             override https://chat.openape.ai
//   APE_CHAT_BRIDGE_APES_BIN      apes binary path (default: 'apes' on PATH)
//   APE_CHAT_BRIDGE_MODEL         per-message model — REQUIRED. Boot
//                                 fails fast if unset. Used to default
//                                 to 'claude-haiku-4-5' but that
//                                 silently misrouted on LiteLLM proxies
//                                 fronting only ChatGPT or only
//                                 Anthropic, producing 400s on every
//                                 message instead of a clear startup
//                                 error.
//   APE_CHAT_BRIDGE_TOOLS         comma-separated tool names (default: '' — no tools)
//   APE_CHAT_BRIDGE_MAX_STEPS     max tool-call rounds per turn (default: 10)
//   APE_CHAT_BRIDGE_SYSTEM_PROMPT fallback system prompt when agent.json is missing
//   APE_CHAT_BRIDGE_ROOM          restrict to one room id

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { ensureFreshIdpAuth, NotLoggedInError } from '@openape/cli-auth'
import { decodeJwt } from 'jose'
import WebSocket from 'ws'
import type { RuntimeConfig } from '@openape/apes'
import { ChatApi } from './chat-api'
import { CronRunner } from './cron-runner'
import { readAgentIdentity, readAllowlist, shouldAutoAccept } from './identity'
import { ThreadSession } from './thread-session'

const AGENT_CONFIG_PATH = join(homedir(), '.openape', 'agent', 'agent.json')

/**
 * Resolve the agent's system prompt at the moment we're about to send a
 * message. Reads `~/.openape/agent/agent.json` (written by `apes agents
 * sync`); falls back to env-default when the file is missing or
 * unreadable. Empty string in the file is respected — owner can clear
 * the prompt deliberately.
 */
function resolveSystemPrompt(envFallback: string): string {
  if (!existsSync(AGENT_CONFIG_PATH)) return envFallback
  try {
    const parsed = JSON.parse(readFileSync(AGENT_CONFIG_PATH, 'utf8')) as { systemPrompt?: string }
    return typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : envFallback
  }
  catch { return envFallback }
}

const DEFAULT_ENDPOINT = 'https://chat.openape.ai'
const DEFAULT_APES_BIN = 'apes'
const DEFAULT_MAX_STEPS = 10
const DEFAULT_SYSTEM_PROMPT
  = 'You are a helpful assistant in a 1:1 chat. Be concise and friendly. '
    + 'When asked for facts, say "I don\'t know" rather than guess.'

const PING_INTERVAL_MS = 30_000
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000
const ALLOWLIST_POLL_INTERVAL_MS = 30_000

interface Message {
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

interface WsFrame {
  type: string
  room_id: string
  payload: Record<string, unknown>
}

interface BridgeConfig {
  endpoint: string
  apesBin: string
  model: string
  systemPrompt: string
  tools: string[]
  maxSteps: number
  roomFilter?: string
}

function readConfig(): BridgeConfig {
  const toolsRaw = process.env.APE_CHAT_BRIDGE_TOOLS ?? ''
  const tools = toolsRaw.split(',').map(s => s.trim()).filter(Boolean)
  const maxStepsRaw = process.env.APE_CHAT_BRIDGE_MAX_STEPS
  const maxSteps = maxStepsRaw ? Number.parseInt(maxStepsRaw, 10) : DEFAULT_MAX_STEPS

  // Model is required — there's no safe built-in default. A wrong
  // default silently routes to a model the user's LiteLLM proxy
  // doesn't know about and 400s every chat-completion request,
  // visible only as a runtime error in the chat UI. Failing at
  // startup with a pointer to the fix is much friendlier.
  const model = process.env.APE_CHAT_BRIDGE_MODEL
  if (!model) {
    throw new Error(
      'APE_CHAT_BRIDGE_MODEL is not set. Set it in the bridge .env '
      + '(usually `~/Library/Application Support/openape/bridge/.env` '
      + 'on macOS) or globally in `~/litellm/.env` so resolveBridgeConfig '
      + 'picks it up at spawn time. Common values: `gpt-5.4` (ChatGPT-only '
      + 'LiteLLM proxy), `claude-haiku-4-5` (Anthropic-only).',
    )
  }

  return {
    endpoint: (process.env.APE_CHAT_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/$/, ''),
    apesBin: process.env.APE_CHAT_BRIDGE_APES_BIN ?? DEFAULT_APES_BIN,
    model,
    systemPrompt: process.env.APE_CHAT_BRIDGE_SYSTEM_PROMPT ?? DEFAULT_SYSTEM_PROMPT,
    tools,
    maxSteps: Number.isFinite(maxSteps) && maxSteps > 0 ? maxSteps : DEFAULT_MAX_STEPS,
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
  // Sessions keyed by `${roomId}:${threadId}`. Each ThreadSession holds
  // its own message history and calls @openape/apes' runLoop directly
  // (no stdio JSON-RPC subprocess — see thread-session.ts).
  private threads = new Map<string, ThreadSession>()
  private chat: ChatApi
  private bearer: () => Promise<string>
  private cron: CronRunner | undefined

  constructor(
    private cfg: BridgeConfig,
    private selfEmail: string,
    private ownerEmail: string,
  ) {
    this.bearer = async () => {
      const idp = await ensureFreshIdpAuth()
      return `Bearer ${idp.access_token}`
    }
    this.chat = new ChatApi(this.cfg.endpoint, this.bearer)
    // The cron runner ticks every 60s, fires matching tasks via the
    // same in-process runLoop the chat threads use, posts results as
    // DMs through the existing chat WebSocket connection. Replaces the
    // per-task launchd plist + separate `apes agents run` process model.
    this.cron = new CronRunner({
      runtimeConfig: this.runtimeConfig(),
      chat: this.chat,
      ownerEmail: this.ownerEmail,
      log,
      troopUrl: (process.env.OPENAPE_TROOP_URL ?? 'https://troop.openape.ai').replace(/\/$/, ''),
      bearer: this.bearer,
    })
    this.cron.start()
  }

  /**
   * RuntimeConfig is shared across thread sessions and the cron runner.
   * The bridge resolves it from its own env at boot and reuses for the
   * whole process lifetime.
   */
  private runtimeConfig(): RuntimeConfig {
    const apiBase = (process.env.LITELLM_BASE_URL ?? 'http://127.0.0.1:4000/v1').replace(/\/$/, '')
    const apiKey = process.env.LITELLM_API_KEY ?? process.env.LITELLM_MASTER_KEY ?? ''
    if (!apiKey) {
      throw new Error('LITELLM_API_KEY (or LITELLM_MASTER_KEY) must be set in the bridge env.')
    }
    return { apiBase, apiKey, model: this.cfg.model }
  }

  async sendInitialOwnerRequestIfNeeded(): Promise<void> {
    const contacts = await this.chat.listContacts()
    const ownerLower = this.ownerEmail.toLowerCase()
    const existing = contacts.find(c => c.peerEmail.toLowerCase() === ownerLower)
    if (existing) return
    log(`sending initial contact request to owner ${this.ownerEmail}`)
    try {
      await this.chat.requestContact(this.ownerEmail)
    }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`could not send initial request to ${this.ownerEmail}: ${msg}`)
    }
  }

  async acceptAllowedPendingContacts(): Promise<void> {
    const contacts = await this.chat.listContacts()
    const pending = contacts.filter(c => c.myStatus === 'pending')
    if (pending.length === 0) return
    const allowlist = readAllowlist()
    const identity = { email: this.selfEmail, ownerEmail: this.ownerEmail, idp: '' }
    const accepted: string[] = []
    const skipped: string[] = []
    for (const c of pending) {
      if (!shouldAutoAccept(c.peerEmail, identity, allowlist)) {
        skipped.push(c.peerEmail)
        continue
      }
      try {
        await this.chat.acceptContact(c.peerEmail)
        accepted.push(c.peerEmail)
      }
      catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log(`failed to accept ${c.peerEmail}: ${msg}`)
      }
    }
    if (accepted.length > 0) log(`accepted: ${accepted.join(', ')}`)
    if (skipped.length > 0) log(`skipped (not on allowlist): ${skipped.join(', ')}`)
  }

  handleInbound(msg: Message): void {
    if (msg.senderEmail === this.selfEmail) return
    if (!msg.body.trim()) return
    if (this.cfg.roomFilter && msg.roomId !== this.cfg.roomFilter) return
    if (!msg.threadId) {
      log(`[${msg.roomId}] dropping message ${msg.id} without threadId — server too old?`)
      return
    }

    log(`[${msg.roomId}/${msg.threadId.slice(0, 8)}] in: ${truncate(msg.body, 80)}`)
    const session = this.getOrCreateThread(msg.roomId, msg.threadId)
    session.enqueue(msg.body, msg.id)
  }

  private getOrCreateThread(roomId: string, threadId: string): ThreadSession {
    const key = `${roomId}:${threadId}`
    let s = this.threads.get(key)
    if (s) return s
    s = new ThreadSession({
      roomId,
      threadId,
      chat: this.chat,
      runtimeConfig: this.runtimeConfig(),
      systemPrompt: resolveSystemPrompt(this.cfg.systemPrompt),
      tools: this.cfg.tools,
      maxSteps: this.cfg.maxSteps,
      log,
    })
    this.threads.set(key, s)
    return s
  }

  async pumpOnce(): Promise<void> {
    const bearer = await this.bearer()
    const wsUrl = `${this.cfg.endpoint.replace(/^http/, 'ws')}/api/ws?token=${encodeURIComponent(bearer.replace(/^Bearer\s+/i, ''))}`
    const ws = new WebSocket(wsUrl)
    return new Promise<void>((resolve, reject) => {
      let pingTimer: NodeJS.Timeout | undefined
      let allowlistTimer: NodeJS.Timeout | undefined

      ws.on('open', () => {
        log(`connected as ${this.selfEmail} → ${this.cfg.endpoint}`)
        pingTimer = setInterval(() => ws.ping(), PING_INTERVAL_MS)
        void this.sendInitialOwnerRequestIfNeeded().catch((err) => {
          log(`initial owner request failed: ${err instanceof Error ? err.message : String(err)}`)
        })
        void this.acceptAllowedPendingContacts().catch((err) => {
          log(`accept-pending-contacts failed: ${err instanceof Error ? err.message : String(err)}`)
        })
        allowlistTimer = setInterval(() => {
          void this.acceptAllowedPendingContacts().catch((err) => {
            log(`allowlist re-poll failed: ${err instanceof Error ? err.message : String(err)}`)
          })
        }, ALLOWLIST_POLL_INTERVAL_MS)
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
        if (allowlistTimer) clearInterval(allowlistTimer)
        resolve()
      })
      ws.on('error', (err: Error) => {
        if (pingTimer) clearInterval(pingTimer)
        if (allowlistTimer) clearInterval(allowlistTimer)
        reject(err)
      })
    })
  }
}

async function main(): Promise<void> {
  const cfg = readConfig()
  const idpId = await getIdentity()
  const onDisk = readAgentIdentity()
  if (onDisk.email.toLowerCase() !== idpId.email.toLowerCase()) {
    throw new Error(
      `auth.json email (${onDisk.email}) doesn't match IdP token sub (${idpId.email}) — refusing to start`,
    )
  }

  log(
    `bridge starting — agent=${onDisk.email} owner=${onDisk.ownerEmail} `
    + `apes=${cfg.apesBin} model=${cfg.model} tools=[${cfg.tools.join(',') || 'none'}] `
    + `max_steps=${cfg.maxSteps} room=${cfg.roomFilter ?? '*'}`,
  )

  const bridge = new Bridge(cfg, onDisk.email, onDisk.ownerEmail)
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
