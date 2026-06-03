// ape-agent (formerly openape-chat-bridge)
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
import type { Detector } from '@openape/prompt-injection-detector'
import { createHeuristicDetector, decide } from '@openape/prompt-injection-detector'
import { decodeJwt } from 'jose'
import WebSocket from 'ws'
import type { RuntimeConfig } from '@openape/apes'
import { ChatApi } from './chat-api'
import { TroopChatApi } from './troop-chat-api'
import { CronRunner } from './cron-runner'
import { readAgentIdentity, readAllowlist, shouldAutoAccept } from './identity'
import { composeSystemPrompt } from './skills'
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

interface BridgeConfig {
  endpoint: string
  apesBin: string
  model: string
  systemPrompt: string
  tools: string[]
  maxSteps: number
  roomFilter?: string
  /**
   * Which backend hosts the chat surface this bridge connects to.
   * `chat` (default) targets chat.openape.ai's shape: WS at /api/ws,
   * room+thread model, contact handshake. `troop` targets troop's
   * native 1:1-per-(owner,agent) chat: WS at /_ws/chat, one synthetic
   * thread, no contact dance. Set via `OPENAPE_BRIDGE_TARGET`.
   *
   * The two backends are not wire-compatible — the bridge picks the
   * ChatApi impl + WS path + frame translation at startup, so a flip
   * needs a bridge restart (pm2 restart openape-bridge-<name>).
   */
  target: 'chat' | 'troop'
}

/**
 * Load env vars from the bridge .env file written at spawn time.
 * Merges into process.env (no overwrite — process.env wins). Used to
 * have a start.sh wrapper that sourced this file; with the Nest
 * supervisor invoking the bridge directly we load it here. Silent
 * no-op if the file is missing (covers ad-hoc invocations + tests).
 */
function loadBridgeEnvFile(): void {
  // REMOVE-AFTER: cutover-verified (see MIGRATION-mac-to-docker.md)
  // Mac-only path. Docker nests pass env via compose environment: block, not
  // this file. Remove once all live nests are Docker-based.
  const path = join(homedir(), 'Library', 'Application Support', 'openape', 'bridge', '.env')
  if (!existsSync(path)) return
  try {
    const raw = readFileSync(path, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq < 0) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (!key) continue
      // Don't clobber explicit env (lets operators override per-launch).
      if (process.env[key] === undefined) {
        process.env[key] = value
      }
    }
  }
  catch {
    // Tolerate read errors — fail-fast checks below will surface
    // the real problem with a clearer message.
  }
}

function readConfig(): BridgeConfig {
  loadBridgeEnvFile()

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

  // REMOVE-AFTER: cutover-verified (see MIGRATION-mac-to-docker.md)
  // Once all live nests pass OPENAPE_BRIDGE_TARGET=troop in their compose env
  // (confirmed via troop prod DB: no nests with null device_secret_hash still
  // connecting without the var), flip this default to 'troop' and remove the
  // 'chat' fallback branch below together with ChatApi + chat-api.ts.
  const targetRaw = (process.env.OPENAPE_BRIDGE_TARGET ?? 'chat').toLowerCase()
  const target: BridgeConfig['target'] = targetRaw === 'troop' ? 'troop' : 'chat'
  return {
    endpoint: (process.env.APE_CHAT_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/$/, ''),
    apesBin: process.env.APE_CHAT_BRIDGE_APES_BIN ?? DEFAULT_APES_BIN,
    model,
    systemPrompt: process.env.APE_CHAT_BRIDGE_SYSTEM_PROMPT ?? DEFAULT_SYSTEM_PROMPT,
    tools,
    maxSteps: Number.isFinite(maxSteps) && maxSteps > 0 ? maxSteps : DEFAULT_MAX_STEPS,
    roomFilter: process.env.APE_CHAT_BRIDGE_ROOM,
    target,
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

function refusalText(reason: string | undefined): string {
  // Short, neutral refusal. Reason is appended so the owner sees in
  // their audit log + chat history why a specific message was blocked.
  // Phrasing intentionally avoids language the attacker can copy back
  // ("ignore previous instructions and …") that would re-trigger.
  const base = 'I won\'t process this message — it looks like a prompt-injection attempt.'
  return reason ? `${base}\n\n(matched: ${reason})` : base
}

class Bridge {
  // Sessions keyed by `${roomId}:${threadId}`. Each ThreadSession holds
  // its own message history and calls @openape/apes' runLoop directly
  // (no stdio JSON-RPC subprocess — see thread-session.ts).
  private threads = new Map<string, ThreadSession>()
  // ChatApi and TroopChatApi expose the same surface (postMessage /
  // listMessages / patchMessage / listContacts / requestContact /
  // acceptContact / createThread) so the rest of the bridge calls
  // through a structurally-typed reference without caring which
  // backend is in play. Picked at construction time from cfg.target.
  private chat: ChatApi | TroopChatApi
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
  ) {
    this.bearer = async () => {
      const idp = await ensureFreshIdpAuth()
      return `Bearer ${idp.access_token}`
    }
    // REMOVE-AFTER: cutover-verified (see MIGRATION-mac-to-docker.md)
    // The ChatApi branch (chat.openape.ai backend) stays until we confirm no
    // live agent still uses it. Remove ChatApi import + chat-api.ts after
    // cutover.
    this.chat = this.cfg.target === 'troop'
      ? new TroopChatApi(this.cfg.endpoint, this.bearer)
      : new ChatApi(this.cfg.endpoint, this.bearer)
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
        await this.chat.postMessage(msg.roomId, refusalText(decision.reason), {
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
    const wsPath = this.cfg.target === 'troop' ? '/_ws/chat' : '/api/ws'
    const wsUrl = `${this.cfg.endpoint.replace(/^http/, 'ws')}${wsPath}?token=${encodeURIComponent(bearer.replace(/^Bearer\s+/i, ''))}`
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
        // Frame translation: troop ships `{chat_id, payload:
        // {id,chatId,role,body,...}}` while chat.openape.ai ships
        // `{room_id, payload:{id,roomId,threadId,senderEmail,senderAct,
        //  body,...}}`. Normalize to the bridge's chat.openape.ai-style
        // Message shape so handleInbound stays target-agnostic.
        const msg: Message = this.cfg.target === 'troop'
          ? this.translateTroopPayload(frame.chat_id ?? '', frame.payload)
          : (frame.payload as unknown as Message)
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
