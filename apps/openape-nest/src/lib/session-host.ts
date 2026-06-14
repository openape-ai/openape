import type { AgentEntry } from './registry'

/**
 * Common contract for the nest's agent supervisor, so `index.ts` can swap
 * implementations behind a flag without caring which one runs.
 */
export interface AgentSupervisor {
  reconcile: (desired: AgentEntry[]) => Promise<void>
}

/**
 * In-process agent supervisor — the single-process-nest target
 * (see .claude/plans/single-process-nest.md). It replaces the per-agent
 * pm2 daemons + `ape-agent` child processes (26 processes for 13 agents)
 * with N in-process AgentSessions in this one nest process. Isolation
 * moves to tool-execution time via `sudo -u <agent>`: the M0 spike proved
 * each agent self-materializes its own sealed secrets as itself, so the
 * nest never holds plaintext.
 *
 * Gated behind OPENAPE_NEST_INPROCESS=1 — with the flag off the proven
 * pm2 path is untouched. This is increment 1: the scaffold + the
 * reconcile contract, so the flag path is observable end-to-end before
 * the per-agent runtime loops + sudo-drop tool execution land in the
 * following increments.
 */
export class SessionHost implements AgentSupervisor {
  constructor(private deps: { log: (line: string) => void }) {}

  async reconcile(desired: AgentEntry[]): Promise<void> {
    const names = desired.map(a => a.name).join(', ') || '(none)'
    this.deps.log(`session-host: in-process mode would host ${desired.length} agent(s): ${names}`)
  }
}
