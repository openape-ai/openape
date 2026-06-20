import type { BridgeConfig, TroopMessage } from '@openape/ape-agent'
import type { AgentEntry } from './registry'
import type { HostedSession } from './session-host'
import { AgentSession, readAgentIdentity, ThreadSession, TroopChatApi } from '@openape/ape-agent'
import type { IdpAuth, SpToken } from '@openape/cli-auth'
import { ensureFreshIdpAuth, exchangeForSpToken } from '@openape/cli-auth'
import WebSocket from 'ws'
import type { OpenclawAgent, OpenclawRuntime } from './openclaw-adapter'
import { resolveBridgeConfig } from './bridge-config'
import { isAgentPaused } from './nest-state'
import { invokeOpenclaw, prepareOpenclawHome, sudoRunAs } from './openclaw-adapter'

/** Inject the openclaw exec for tests; defaults to the real one-shot invoker. */
export interface OpenclawTurnDeps {
  invoke: (agent: OpenclawAgent, rt: OpenclawRuntime, message: string, sessionKey: string) => Promise<string>
}

/** The chat surface a turn drives: a streaming placeholder, then a patch. */
export interface OpenclawChat {
  postMessage: (roomId: string, body: string, opts: { replyTo?: string, threadId?: string, streaming?: boolean }) => Promise<{ id: string }>
  patchMessage: (id: string, opts: { body?: string, streaming?: boolean }) => Promise<void>
}

/**
 * Run one openclaw turn for an accepted chat message. openclaw is one-shot (no
 * token stream), so post an empty `streaming: true` placeholder first — the chat
 * renders that as the agent "typing…" — run the exec, then patch the finished
 * reply in (`streaming: false`). Without the placeholder the human sees nothing
 * until the whole reply lands. Exported so the flow is unit-tested without a
 * live openclaw or troop: inject `invoke`, spy on `chat`.
 */
export async function runOpenclawTurn(
  agent: OpenclawAgent,
  rt: OpenclawRuntime,
  message: Pick<TroopMessage, 'body' | 'roomId' | 'threadId' | 'id'>,
  chat: OpenclawChat,
  deps: OpenclawTurnDeps = { invoke: invokeOpenclaw },
): Promise<void> {
  const placeholder = await chat.postMessage(message.roomId, '', {
    replyTo: message.id,
    threadId: message.threadId,
    streaming: true,
  })
  try {
    const reply = await deps.invoke(agent, rt, message.body, `${message.roomId}:${message.threadId}`)
    await chat.patchMessage(placeholder.id, { body: reply, streaming: false })
  }
  catch (err) {
    await chat.patchMessage(placeholder.id, { body: '⚠️ openclaw turn failed', streaming: false }).catch(() => {})
    throw err
  }
}

/** Injectable seam for {@link resolveOpenclawGatewayKey} (real exchange in prod). */
export interface GatewayKeyDeps {
  ensureIdp: (home: string) => Promise<IdpAuth>
  exchange: (idp: IdpAuth, req: { endpoint: string, aud: string }) => Promise<SpToken>
}
const realGatewayKeyDeps: GatewayKeyDeps = {
  ensureIdp: home => ensureFreshIdpAuth(undefined, home),
  exchange: (idp, req) => exchangeForSpToken(idp, req),
}

/**
 * Mint this agent's gateway key for one openclaw turn. For the DDISA gateway
 * (`llms.openape.ai`) the static env key is NOT accepted (the gateway is
 * DDISA-only) — so exchange the agent's own IdP token (read from *its* home via
 * `authHome`, so the one daemon mints per agent) for a short-lived gateway
 * token. This mirrors the per-agent bridge's `resolveLlmGatewayKey`; openclaw is
 * one-shot, so we mint per turn. For any other base (e.g. a local codex-proxy)
 * the static `fallback` stands. Any exchange error returns `fallback` so a flaky
 * mint never strands the agent.
 */
export async function resolveOpenclawGatewayKey(
  apiBase: string,
  fallback: string,
  home: string,
  log: (line: string) => void,
  deps: GatewayKeyDeps = realGatewayKeyDeps,
): Promise<string> {
  if (!apiBase.includes('llms.openape.ai'))
    return fallback
  try {
    const u = new URL(apiBase)
    const idp = await deps.ensureIdp(home)
    const sp = await deps.exchange(idp, { endpoint: u.origin, aud: u.host })
    return sp.access_token
  }
  catch (err) {
    log(`openclaw gateway token exchange failed (keeping env key): ${err instanceof Error ? err.message : String(err)}`)
    return fallback
  }
}

/**
 * Minimal view of the troop chat WebSocket the runtime session drives — just the
 * lifecycle surface it wires (`open`/`close`/`error`) plus `close()` for
 * teardown. The real `ws` {@link WebSocket} satisfies this; tests inject a fake.
 */
export interface ChatSocket {
  on: ((event: 'open' | 'close', cb: () => void) => void) &
    ((event: 'error', cb: (err: Error) => void) => void) &
    ((event: 'message', cb: (data: unknown) => void) => void)
  close: () => void
}

/** Opens a chat socket for the given URL. Defaults to the real `ws` client. */
export type ChatSocketFactory = (url: string) => ChatSocket

const defaultChatSocketFactory: ChatSocketFactory = url => new WebSocket(url)

/**
 * Per-agent context the nest supplies to construct an agent's runtime. The
 * registry entry carries identity (email) and per-agent bridge overrides, but
 * the owner email and the resolved bridge config (model, system prompt, tools,
 * troop endpoint) come from the nest's own environment — exactly the values the
 * pm2 path forwarded via the spawned child's env block.
 */
export interface AgentRuntimeContext {
  ownerEmail: string
  bridgeConfig: BridgeConfig
  /**
   * Resolves this agent's troop bearer (`Bearer <jwt>`). When present, the
   * factory derives the agent's chat-socket URL at start time and connects.
   * {@link resolveAgentRuntimeContext} now wires the production bearer: a fresh
   * IdP token read from the agent's *own* home via `@openape/cli-auth`'s
   * `ensureFreshIdpAuth` (which also refreshes the 1h-expiring agent token from
   * the on-disk signing key). Mirrors the per-agent bridge's bearer exactly
   * (`bridge.ts`: `Bearer ${(await ensureFreshIdpAuth()).access_token}`). The
   * call is lazy — only made when the session actually starts — so resolving a
   * context never touches the network. Tests inject a stub.
   */
  bearer?: () => Promise<string>
  /**
   * Opens the troop chat WebSocket. Defaults to the real `ws` client; tests
   * inject a fake to observe lifecycle wiring without a live socket. Only ever
   * called when {@link bearer} is set, so production (where
   * {@link resolveAgentRuntimeContext} leaves `bearer` unset) never connects.
   */
  chatSocketFactory?: ChatSocketFactory
  /**
   * Posts the prompt-injection **refusal** back to troop on a blocked message —
   * the choke-point's only direct post. An accepted message's reply is *not*
   * posted here: the {@link dispatchTurn} `ThreadSession` streams it straight
   * back via its own chat backend. Mirrors the per-agent bridge, whose refusal
   * posts via `this.chat.postMessage(roomId, text, { replyTo, threadId })`
   * (`bridge.ts`) while replies stream from the `ThreadSession`. Optional and
   * only consulted inside the bearer-gated socket block;
   * {@link resolveAgentRuntimeContext} wires the production poster — a canonical
   * `TroopChatApi` bound to the agent's troop endpoint + bearer — so the
   * production path posts the injection refusal back. Tests inject a spy.
   */
  chatPoster?: (
    roomId: string,
    text: string,
    opts: { replyTo: string, threadId: string },
  ) => Promise<void>
  /**
   * Dispatches one accepted, non-blocked {@link TroopMessage} into the agent's
   * per-thread runtime. Fire-and-forget by design: the canonical `ThreadSession`
   * (`@openape/ape-agent`, the same per-`${roomId}:${threadId}` keyed session the
   * per-agent bridge runs) owns the turn end-to-end — it streams the reply
   * straight back to troop via its own chat backend, keeps per-thread history
   * plus a hung-backend watchdog, and surfaces its own errors. There is
   * therefore no reply text to return and no reply for the seam to post;
   * {@link chatPoster} stays the refusal-only path. Optional and only consulted
   * for accepted messages inside the bearer-gated socket block.
   * {@link resolveAgentRuntimeContext} now wires the production dispatcher: a
   * per-`${roomId}:${threadId}` keyed `ThreadSession` (the same canonical
   * session the per-agent bridge runs) is created on demand and the message is
   * enqueued onto it. The in-process turn runs **text-only** (no tools) until M3
   * lands the `sudo -u <agent>` tool-drop, since the runtime runs as the nest's
   * root and enabling the bridge's tools here would execute them as root — a
   * privilege regression. Tests inject a spy.
   */
  dispatchTurn?: (message: TroopMessage) => void
}

/**
 * Strip the bearer token from a chat-socket URL so it is safe to log. The token
 * rides in the `token` query param ({@link AgentSession.chatSocketUrl}); the
 * nest log must never carry it in the clear.
 */
function redactSocketToken(url: string): string {
  return url.replace(/([?&]token=)[^&]*/, '$1<redacted>')
}

/**
 * Resolve the full {@link AgentRuntimeContext} for one hosted agent from the
 * registry entry and the nest's env. The owner email comes from the agent's own
 * identity file (`<home>/.config/apes/auth.json`) via the bridge's own
 * {@link readAgentIdentity} — pointed at the registry entry's `home` so the one
 * daemon reads each agent's identity from that agent's home, with no second copy
 * of the auth.json parsing/fallback rules. The bridge config is resolved from the
 * nest env with the per-agent registry override (see {@link resolveBridgeConfig}).
 *
 * The {@link AgentRuntimeContext.bearer} resolver refreshes the agent's troop
 * token from that same home via `ensureFreshIdpAuth(undefined, entry.home)` —
 * the `authHome` argument points the published helper at the agent's own
 * `auth.json` so the one daemon mints every hosted agent's bearer without env
 * juggling. The call is lazy (only fired when the factory opens the socket), so
 * resolving the context itself reads only the identity file and never the
 * network.
 *
 * The {@link AgentRuntimeContext.chatPoster} is the agent's canonical
 * {@link TroopChatApi}, bound to the resolved troop endpoint and the same lazy
 * `bearer` — no second copy of troop's POST shape. Constructing it is cheap
 * (endpoint + bearer only); the first network call happens when the seam posts a
 * refusal (replies stream from the {@link AgentRuntimeContext.dispatchTurn}
 * `ThreadSession`, not here), so resolving the context still touches no network.
 *
 * The {@link AgentRuntimeContext.dispatchTurn} drives one
 * per-`${roomId}:${threadId}` keyed {@link ThreadSession} (the same canonical
 * session the per-agent bridge runs via `getOrCreateThread`), created on demand
 * and sharing the agent's `chat` backend plus a single {@link RuntimeConfig}
 * resolved from the nest env (`LITELLM_*` + the agent's model), exactly as the
 * bridge's own `runtimeConfig()`. The turn runs **text-only** (no tools) until
 * M3 lands the `sudo -u <agent>` tool-drop — see the field doc. The `log` sink
 * is the nest's logger, forwarded so per-thread diagnostics land in the daemon
 * log.
 */
export function resolveAgentRuntimeContext(
  entry: AgentEntry,
  env: NodeJS.ProcessEnv,
  log: (line: string) => void = () => {},
): AgentRuntimeContext {
  const bridgeConfig = resolveBridgeConfig(entry, env)
  const bearer = async (): Promise<string> =>
    `Bearer ${(await ensureFreshIdpAuth(undefined, entry.home)).access_token}`
  const chat = new TroopChatApi(bridgeConfig.endpoint, bearer)

  // The LiteLLM proxy + model the per-thread runtime drives, resolved from the
  // nest env exactly as the per-agent bridge's `runtimeConfig()`
  // (`LITELLM_BASE_URL` / `LITELLM_API_KEY` + the agent's model). Built once and
  // shared across this agent's threads.
  const apiBase = (env.LITELLM_BASE_URL ?? 'http://127.0.0.1:4000/v1').replace(/\/$/, '')
  const apiKey = env.LITELLM_API_KEY ?? ''
  const runtimeConfig = { apiBase, apiKey, model: bridgeConfig.model }

  // One ThreadSession per `${roomId}:${threadId}`, mirroring the bridge's
  // `getOrCreateThread`. Each owns its per-thread history, streaming, and
  // watchdog, and streams its reply straight back to troop via `chat` — so the
  // dispatcher returns nothing and the refusal-only `chatPoster` is untouched.
  const threads = new Map<string, ThreadSession>()

  // openclaw (foreign one-shot runtime): instead of a per-thread ThreadSession,
  // each accepted message exec's `openclaw agent --local` and we post its reply.
  // openclaw has no daemon — the nest drives one turn per message. The agent's
  // CLIs (apes/ape-tasks/ape-troop) are its tools and read its auth.json, so
  // actions land under the DDISA identity. Runs as the nest user with
  // HOME=<agent home> for now (reads the agent's auth.json) — the `sudo -u
  // <agent>` drop is the SAME pending isolation work as the bridge's text-only
  // limitation below; until it lands, openclaw shares that constraint.
  if (entry.runtimeType === 'openclaw') {
    const oclAgent = { name: entry.name, email: entry.email, home: entry.home, uid: entry.uid }
    // In the container sandbox (OPENAPE_BYPASS_APE_SHELL=1, same flag the bridge
    // reads) drop the exec — and its CLI tool-calls — to the agent's OS user via
    // passwordless `sudo -u`. On the host/dev path openclaw runs as the nest user.
    const runAs = process.env.OPENAPE_BYPASS_APE_SHELL === '1' ? sudoRunAs(entry.name) : undefined
    return {
      ownerEmail: readAgentIdentity(entry.home).ownerEmail,
      bridgeConfig,
      bearer,
      chatPoster: async (roomId, text, opts) => {
        await chat.postMessage(roomId, text, { replyTo: opts.replyTo, threadId: opts.threadId })
      },
      dispatchTurn: (message) => {
        if (isAgentPaused(entry.name)) {
          log(`agent-runtime: ⏸ ${entry.name} paused, dropping turn (no tokens)`)
          return
        }
        void (async () => {
          try {
            // Mint a fresh per-agent DDISA gateway token each turn (the gateway
            // is DDISA-only — the static env key 401s), then (re)write the
            // openclaw config with it before the one-shot exec.
            const key = await resolveOpenclawGatewayKey(apiBase, apiKey, entry.home, log)
            const turnRt = { apiBase, apiKey: key, model: bridgeConfig.model, systemPrompt: bridgeConfig.systemPrompt }
            prepareOpenclawHome(oclAgent, turnRt)
            await runOpenclawTurn(oclAgent, turnRt, message, chat, {
              invoke: (a, r, m, sk) => invokeOpenclaw(a, r, m, sk, runAs ? { runAs } : undefined),
            })
          }
          catch (err) {
            log(`agent-runtime: ! ${entry.name} openclaw turn failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
          }
        })()
      },
    }
  }

  return {
    ownerEmail: readAgentIdentity(entry.home).ownerEmail,
    bridgeConfig,
    bearer,
    chatPoster: async (roomId, text, opts) => {
      await chat.postMessage(roomId, text, { replyTo: opts.replyTo, threadId: opts.threadId })
    },
    dispatchTurn: (message) => {
      if (isAgentPaused(entry.name)) {
        log(`agent-runtime: ⏸ ${entry.name} paused, dropping turn (no tokens)`)
        return
      }
      // Without an API key runLoop can't reach the model at all — fail loudly
      // per turn rather than silently swallowing it. (The bridge fails fast at
      // boot on the same missing key; the nest keeps reconcile alive and logs
      // here so one misconfigured agent never strands the others.)
      if (!apiKey) {
        log(`agent-runtime: ! ${entry.name} cannot dispatch — LITELLM_API_KEY unset`)
        return
      }
      const key = `${message.roomId}:${message.threadId}`
      let thread = threads.get(key)
      if (!thread) {
        thread = new ThreadSession({
          roomId: message.roomId,
          threadId: message.threadId,
          chat,
          runtimeConfig,
          // Text-only until M3: the runtime runs as the nest's root and the
          // `sudo -u <agent>` tool-drop isn't built yet, so enabling the
          // bridge's tools here would execute them as root. Ship text-only
          // (no tools, raw system prompt) so WS→parse→dispatch→runLoop→reply is
          // functional and safe; M3 restores tools behind the sudo-drop.
          resolveConfig: () => ({ systemPrompt: bridgeConfig.systemPrompt, tools: [] }),
          selfEmail: entry.email,
          maxSteps: bridgeConfig.maxSteps,
          log,
        })
        threads.set(key, thread)
      }
      thread.enqueue(message.body, message.id)
    },
  }
}

/**
 * Real {@link HostedSession} factory: wraps an `@openape/ape-agent`
 * {@link AgentSession} so the SessionHost hosts the actual agent runtime instead
 * of the no-op placeholder. `start()` constructs the AgentSession from the
 * registry entry and the nest-supplied context and **retains it** on the
 * session; `stop()` tears that retained instance down. Holding the constructed
 * AgentSession (rather than discarding it after logging) is the seam the next
 * increments hang off: opening the troop WS, running the LLM loop, and dropping
 * tool calls to `sudo -u <agent>` all act on this same retained instance.
 *
 * `start()`/`stop()` are idempotent against the retained instance: a second
 * `start()` while already hosting is a no-op (so a retry never constructs — and,
 * once the WS lands, never re-opens — a duplicate), and `stop()` only tears down
 * an instance it actually holds (so a double-stop never closes a socket twice).
 * The SessionHost already serializes reconcile and retries stranded starts via
 * the central tick, so these guards keep that machinery from doubling up the
 * real runtime once `start()` has side effects.
 *
 * Wired into {@link SessionHost} via its injectable `createSession` option; the
 * default factory stays the placeholder, so the OPENAPE_NEST_INPROCESS path is
 * unchanged until index.ts opts in.
 */
export function createAgentRuntimeSession(
  entry: AgentEntry,
  ctx: AgentRuntimeContext,
  log: (line: string) => void,
): HostedSession {
  let session: AgentSession | undefined
  let socket: ChatSocket | undefined

  return {
    name: entry.name,
    async start() {
      if (session)
        return
      session = new AgentSession(entry.email, ctx.ownerEmail, ctx.bridgeConfig)
      log(`agent-runtime: + ${entry.name} hosting ${session.describe()}`)
      if (ctx.bearer) {
        // Open the troop chat WS on the retained session, mirroring the
        // per-agent bridge's `pumpOnce`. The URL (with its token redacted) is
        // logged; message frames are routed into the agent loop by a later
        // increment. The token rides the URL only — never the log.
        const url = session.chatSocketUrl(await ctx.bearer())
        log(`agent-runtime: ~ ${entry.name} chat socket ${redactSocketToken(url)}`)
        const factory = ctx.chatSocketFactory ?? defaultChatSocketFactory
        socket = factory(url)
        socket.on('open', () => log(`agent-runtime: = ${entry.name} connected`))
        socket.on('close', () => log(`agent-runtime: x ${entry.name} disconnected`))
        socket.on('error', err =>
          log(`agent-runtime: ! ${entry.name} socket error: ${err.message}`))
        socket.on('message', (data) => {
          // Decode the troop frame with the agent's own canonical parser, then
          // translate it into the message the agent loop runs on. troop fans
          // every message back to its sender, so the agent's own replies arrive
          // here too; skip them via the canonical self-echo guard before the
          // runLoop-dispatch increment would otherwise loop the agent forever.
          // Then apply the same pre-loop dispatch filter the bridge uses (empty
          // body / room scope) so noise never reaches the loop. Surviving
          // messages are screened for prompt injection — the bridge's
          // choke-point before the runtime — and blocked ones are refused (no
          // dispatch). Dispatch into the LLM loop lands in a later increment;
          // for now an accepted message's room + sender are logged (no body,
          // no token).
          // Capture the retained session so the async screen callback below
          // keeps a stable handle even if a concurrent stop() clears the field.
          const active = session
          const frame = active?.parseChatFrame(data)
          if (!frame || !active)
            return
          const message = active.toMessage(frame)
          if (active.isOwnEcho(message) || !active.shouldDispatch(message))
            return
          void active.screenInjection(message)
            .then(async (decision) => {
              if (decision.blocked) {
                log(`agent-runtime: ! ${entry.name} BLOCKED prompt-injection in chat ${message.roomId} (score=${decision.score.toFixed(2)}, reason=${decision.reason ?? 'n/a'})`)
                // Post the canonical refusal back, mirroring the bridge's
                // choke-point (`bridge.ts` posts refusalText on a block). The
                // reason is appended for the owner's audit trail; the body is
                // never echoed. A failed post is logged, not thrown — same as
                // the bridge.
                if (ctx.chatPoster) {
                  await ctx.chatPoster(message.roomId, active.refusalText(decision.reason), {
                    replyTo: message.id,
                    threadId: message.threadId,
                  }).catch(err =>
                    log(`agent-runtime: ! ${entry.name} failed to post refusal: ${err instanceof Error ? err.message : String(err)}`))
                }
                return
              }
              log(`agent-runtime: > ${entry.name} message from ${message.senderAct} in chat ${message.roomId}`)
              // Dispatch the accepted message fire-and-forget into the agent's
              // per-thread runtime, mirroring the bridge's accept path
              // (`handleInbound` → getOrCreateThread → enqueue). The canonical
              // `ThreadSession` owns the turn end-to-end — it streams its reply
              // straight back to troop via its own chat backend, keeps per-thread
              // history plus a watchdog, and surfaces its own errors — so nothing
              // returns here and the reply is never posted via the refusal-only
              // `chatPoster`. Injected; production leaves `dispatchTurn` unset
              // until the dispatcher is wired, so this stays inert.
              ctx.dispatchTurn?.(message)
            })
            .catch(err =>
              log(`agent-runtime: ! ${entry.name} injection screen error: ${err instanceof Error ? err.message : String(err)}`))
        })
      }
    },
    async stop() {
      if (!session)
        return
      const hosted = session.describe()
      socket?.close()
      socket = undefined
      session = undefined
      log(`agent-runtime: - ${entry.name} stopped ${hosted}`)
    },
  }
}
