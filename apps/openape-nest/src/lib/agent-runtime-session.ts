import type { BridgeConfig } from '@openape/ape-agent'
import type { AgentEntry } from './registry'
import type { HostedSession } from './session-host'
import { AgentSession, readAgentIdentity } from '@openape/ape-agent'
import { resolveBridgeConfig } from './bridge-config'

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

  return {
    name: entry.name,
    async start() {
      if (session)
        return
      session = new AgentSession(entry.email, ctx.ownerEmail, ctx.bridgeConfig)
      log(`agent-runtime: + ${entry.name} hosting ${session.describe()}`)
    },
    async stop() {
      if (!session)
        return
      const hosted = session.describe()
      session = undefined
      log(`agent-runtime: - ${entry.name} stopped ${hosted}`)
    },
  }
}
