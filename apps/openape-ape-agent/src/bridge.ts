// ape-agent (formerly openape-chat-bridge)
//
// Long-running daemon. Connects to troop.openape.ai via WebSocket using
// the agent's IdP token. For each inbound message that wasn't sent by
// the agent itself, forwards into the in-process runLoop. Streams
// text_delta events back as progressive PATCH updates on a placeholder
// chat message — so the human sees the agent "type" in real time, with
// memory across messages in the same thread.
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
//   OPENAPE_TROOP_URL             override https://troop.openape.ai (bridge target)
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
import type { Detector } from '@openape/prompt-injection-detector'
import { createHeuristicDetector, decide } from '@openape/prompt-injection-detector'
import { decodeJwt } from 'jose'
import WebSocket from 'ws'
import type { RuntimeConfig } from '@openape/apes'
import { startSecretsWatcher } from '@openape/apes'
import type { BridgeConfig } from './bridge-config'
import { readConfig } from './bridge-config'
import { TroopChatApi } from './troop-chat-api'
import { CronRunner } from './cron-runner'
import { readAgentIdentity, readAllowlist, shouldAutoAccept } from './identity'
import { composeSystemPrompt } from './skills'
import { ThreadSession } from './thread-session'
import { AgentSession } from './agent-session'

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

/**
 * Resolve the agent's tool whitelist for chat-bridge runtime.
 * Source of truth (priority order):
 *   1. `~/.openape/agent/agent.json` (`tools[]` written by the
 *      latest `apes agents sync` from troop) — the live owner-
 *      controlled config.
 *   2. `APE_CHAT_BRIDGE_TOOLS` env var (legacy fallback) — the
 *      deprecated mechanism left in place so old deployments
 *      keep working until they sync.
 *   3. `[]` — pure-chat agent, no tools.
 */
function resolveTools(envFallback: string[]): string[] {
  if (existsSync(AGENT_CONFIG_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(AGENT_CONFIG_PATH, 'utf8')) as { tools?: unknown }
      if (Array.isArray(parsed.tools)) {
        return parsed.tools.filter((t): t is string => typeof t === 'string')
      }
    }
    catch { /* fall through */ }
  }
  return envFallback
}

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
  private chat: TroopChatApi
  private bearer: () => Promise<string>
  private cron: CronRunner | undefined
  // Prompt-injection gate (#277). Pure heuristic by default — pluggable
  // backend later. The bridge is the choke-point for every chat message
  // before it reaches the agent runtime, so this is the right place.
  private injectionDetector: Detector = createHeuristicDetector()

  constructor(
    private cfg: BridgeConfig,
    private selfEmail: string,
    private ownerEmail: string,
    // Canonical, process-global-free home for the per-agent rules the
    // nest also runs in-process. The bridge delegates to it one rule at
    // a time (starting with the refusal wording) so the prod path and
    // the in-process nest path stay byte-identical with no second copy.
    private session: AgentSession,
  ) {
    this.bearer = async () => {
      const idp = await ensureFreshIdpAuth()
      return `Bearer ${idp.access_token}`
    }
    this.chat = new TroopChatApi(this.cfg.endpoint, this.bearer)
    // The cron runner ticks every 60s, fires matching tasks via the
    // same in-process runLoop the chat threads use, posts results as
    // DMs through the existing chat WebSocket connection.
    this.cron = new CronRunner({
      runtimeConfig: this.runtimeConfig(),
      chat: this.chat,
      ownerEmail: this.ownerEmail,
      log,
      troopUrl: this.cfg.endpoint,
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

  /**
   * Translate troop's chat-frame payload shape into the
   * chat.openape.ai-style Message the rest of this bridge expects.
   * Troop's payload uses `role` (human|agent) + `chatId` + no
   * senderEmail; the bridge's handleInbound checks
   * `senderEmail === selfEmail` to skip its own echoes, so we
   * synthesize the email from role (agent → self, human → owner).
   * threadId is the synthetic 'main' because troop has no threads.
   */
  private translateTroopPayload(chatId: string, payload: Record<string, unknown>): Message {
    const role = payload.role === 'agent' ? 'agent' : 'human'
    return {
      id: String(payload.id ?? ''),
      roomId: chatId || String(payload.chatId ?? ''),
      threadId: 'main',
      senderEmail: role === 'agent' ? this.selfEmail : this.ownerEmail,
      senderAct: role,
      body: typeof payload.body === 'string' ? payload.body : '',
      replyTo: typeof payload.replyTo === 'string' ? payload.replyTo : null,
      createdAt: typeof payload.createdAt === 'number' ? payload.createdAt : Math.floor(Date.now() / 1000),
      editedAt: typeof payload.editedAt === 'number' ? payload.editedAt : null,
    }
  }

  async handleInbound(msg: Message): Promise<void> {
    if (msg.senderEmail === this.selfEmail) return
    if (!msg.body.trim()) return
    if (this.cfg.roomFilter && msg.roomId !== this.cfg.roomFilter) return
    if (!msg.threadId) {
      log(`[${msg.roomId}] dropping message ${msg.id} without threadId — server too old?`)
      return
    }

    log(`[${msg.roomId}/${msg.threadId.slice(0, 8)}] in: ${truncate(msg.body, 80)}`)

    // Prompt-injection check (#277). The bridge is the choke-point
    // before pi sees inbound text — by the time the message hits the
    // agent runtime, refusing it is harder (it's already in history)
    // and inconsistent (model may or may not comply with refusal).
    // Owners get a higher threshold so legitimate "run shell, do X"
    // instructions from the actual owner aren't refused.
    const decision = await decide(this.injectionDetector, {
      text: msg.body,
      sender: {
        email: msg.senderEmail,
        isOwner: msg.senderEmail === this.ownerEmail,
      },
    })
    if (decision.blocked) {
      log(`[${msg.roomId}/${msg.threadId.slice(0, 8)}] BLOCKED prompt-injection (score=${decision.score.toFixed(2)}, reason=${decision.reason ?? 'n/a'})`)
      try {
        await this.chat.postMessage(msg.roomId, this.session.refusalText(decision.reason), {
          replyTo: msg.id,
          threadId: msg.threadId,
        })
      }
      catch (err) {
        const m = err instanceof Error ? err.message : String(err)
        log(`[${msg.roomId}] failed to post refusal: ${m}`)
      }
      return
    }

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
      // Resolve tools + systemPrompt on every turn from agent.json
      // (latest sync from troop). Owner edits in the troop UI thus
      // take effect on the very next message in an existing thread —
      // not just on a freshly-opened one. SOUL.md + skills get merged
      // into the system prompt the same way.
      resolveConfig: () => {
        const tools = resolveTools(this.cfg.tools)
        return {
          tools,
          systemPrompt: composeSystemPrompt({
            base: resolveSystemPrompt(this.cfg.systemPrompt),
            enabledTools: tools,
          }),
        }
      },
      selfEmail: this.selfEmail,
      maxSteps: this.cfg.maxSteps,
      log,
    })
    this.threads.set(key, s)
    return s
  }

  async pumpOnce(): Promise<void> {
    const bearer = await this.bearer()
    const wsUrl = `${this.cfg.endpoint.replace(/^http/, 'ws')}/_ws/chat?token=${encodeURIComponent(bearer.replace(/^Bearer\s+/i, ''))}`
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
        let frame: { type?: string, room_id?: string, chat_id?: string, payload?: Record<string, unknown> }
        try { frame = JSON.parse(text) as typeof frame }
        catch { return }
        if (frame.type !== 'message' || !frame.payload) return
        // Troop ships `{chat_id, payload: {id,chatId,role,body,...}}`.
        // Translate to the bridge's internal Message shape.
        const msg: Message = this.translateTroopPayload(frame.chat_id ?? '', frame.payload)
        void this.handleInbound(msg)
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

  // Materialize sealed secrets (secrets.d/*.blob) into this process's env
  // before the agent loop starts, then watch for rotate/revoke. Without
  // this the agent's bash tools never see delivered secrets like
  // FORGEJO_TOKEN — the blobs survive a nest recreate but stay sealed.
  try {
    startSecretsWatcher({ log: m => log(m) })
  }
  catch (err) {
    log(`secrets watcher failed to start: ${err instanceof Error ? err.message : String(err)}`)
  }

  const idpId = await getIdentity()
  const onDisk = readAgentIdentity()
  if (onDisk.email.toLowerCase() !== idpId.email.toLowerCase()) {
    throw new Error(
      `auth.json email (${onDisk.email}) doesn't match IdP token sub (${idpId.email}) — refusing to start`,
    )
  }

  const session = new AgentSession(onDisk.email, onDisk.ownerEmail, cfg)

  log(
    `bridge starting — agent=${session.describe()} `
    + `apes=${cfg.apesBin} model=${cfg.model} tools=[${cfg.tools.join(',') || 'none'}] `
    + `max_steps=${cfg.maxSteps} room=${cfg.roomFilter ?? '*'}`,
  )

  const bridge = new Bridge(cfg, onDisk.email, onDisk.ownerEmail, session)
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
