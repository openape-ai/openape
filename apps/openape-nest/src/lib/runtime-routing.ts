import type { AgentEntry } from './registry'

// Which supervisor owns which agent. The 'bridge' runtime (default) is a
// long-lived pm2 daemon; 'openclaw' (and any future non-bridge runtime) runs
// in-process via the SessionHost. Centralised here so the pm2 supervisor's skip
// and the index.ts routing agree on one rule.

/** True when the agent runs as a pm2-supervised daemon (our bridge). */
export function isDaemonRuntime(agent: AgentEntry): boolean {
  return agent.runtimeType == null || agent.runtimeType === 'bridge'
}

/**
 * Agents the in-process SessionHost should host. With INPROCESS it owns all
 * agents (single-process nest); otherwise only the non-daemon runtimes
 * (openclaw), while the pm2 supervisor keeps the bridge fleet.
 */
export function sessionHostAgents(agents: AgentEntry[], inprocess: boolean): AgentEntry[] {
  return inprocess ? agents : agents.filter(a => !isDaemonRuntime(a))
}
