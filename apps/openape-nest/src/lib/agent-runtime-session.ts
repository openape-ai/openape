import type { BridgeConfig } from '@openape/ape-agent'
import type { AgentEntry } from './registry'
import type { HostedSession } from './session-host'
import { AgentSession } from '@openape/ape-agent'

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
 * Real {@link HostedSession} factory: wraps an `@openape/ape-agent`
 * {@link AgentSession} so the SessionHost hosts the actual agent runtime instead
 * of the no-op placeholder. This is the first increment to carry the real
 * runtime object across the package boundary — `start()` constructs the
 * AgentSession from the registry entry and the nest-supplied context. Opening
 * the troop WS, running the LLM loop, and dropping tool calls to `sudo -u
 * <agent>` land behind this same seam in the following increments.
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
  return {
    name: entry.name,
    async start() {
      const session = new AgentSession(entry.email, ctx.ownerEmail, ctx.bridgeConfig)
      log(`agent-runtime: + ${entry.name} hosting ${session.describe()}`)
    },
    async stop() {
      log(`agent-runtime: - ${entry.name} stopped`)
    },
  }
}
