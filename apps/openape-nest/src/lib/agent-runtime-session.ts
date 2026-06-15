import type { BridgeConfig } from '@openape/ape-agent'
import type { AgentEntry } from './registry'
import type { HostedSession } from './session-host'
import { AgentSession, readAgentIdentity } from '@openape/ape-agent'
import WebSocket from 'ws'
import { resolveBridgeConfig } from './bridge-config'

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
   * Resolves this agent's troop bearer (`Bearer <jwt>`). Optional: when present,
   * the factory derives the agent's chat-socket URL at start time — the last
   * step before the WS-open increment actually connects. Left unset by
   * {@link resolveAgentRuntimeContext} for now: the production bearer must come
   * from the agent's *own* home via `@openape/cli-auth`'s `ensureFreshIdpAuth`
   * (which also refreshes the 1h-expiring agent token), and home-injecting that
   * published helper is a separate, owner-gated step. Tests inject a stub.
   */
  bearer?: () => Promise<string>
  /**
   * Opens the troop chat WebSocket. Defaults to the real `ws` client; tests
   * inject a fake to observe lifecycle wiring without a live socket. Only ever
   * called when {@link bearer} is set, so production (where
   * {@link resolveAgentRuntimeContext} leaves `bearer` unset) never connects.
   */
  chatSocketFactory?: ChatSocketFactory
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
 * Pure resolver: it reads files but mutates nothing and is not wired into
 * index.ts yet — it completes the context the {@link createAgentRuntimeSession}
 * factory needs before the WS-opening increment.
 */
export function resolveAgentRuntimeContext(
  entry: AgentEntry,
  env: NodeJS.ProcessEnv,
): AgentRuntimeContext {
  return {
    ownerEmail: readAgentIdentity(entry.home).ownerEmail,
    bridgeConfig: resolveBridgeConfig(entry, env),
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
          const frame = session?.parseChatFrame(data)
          if (!frame || !session)
            return
          const message = session.toMessage(frame)
          if (session.isOwnEcho(message) || !session.shouldDispatch(message))
            return
          void session.screenInjection(message)
            .then((decision) => {
              if (decision.blocked) {
                log(`agent-runtime: ! ${entry.name} BLOCKED prompt-injection in chat ${message.roomId} (score=${decision.score.toFixed(2)}, reason=${decision.reason ?? 'n/a'})`)
                return
              }
              log(`agent-runtime: > ${entry.name} message from ${message.senderAct} in chat ${message.roomId}`)
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
