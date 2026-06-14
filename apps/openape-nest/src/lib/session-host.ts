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
 * pm2 path is untouched. This increment tracks the desired agent set as a
 * lifecycle map and logs add/remove transitions on each reconcile. The
 * transition points are where `session.start()` / `session.stop()` plug in
 * once the per-agent runtime loops + sudo-drop tool execution land; today
 * the host only bookkeeps, so the flag path stays non-breaking.
 */
export class SessionHost implements AgentSupervisor {
  /** Agents the host currently considers live, keyed by name. */
  private readonly active = new Map<string, AgentEntry>()

  constructor(private readonly deps: { log: (line: string) => void }) {}

  async reconcile(desired: AgentEntry[]): Promise<void> {
    const next = new Map(desired.map(a => [a.name, a]))
    const added = [...next.keys()].filter(name => !this.active.has(name))
    const removed = [...this.active.keys()].filter(name => !next.has(name))

    for (const name of added)
      this.deps.log(`session-host: + ${name} (start pending)`)
    for (const name of removed)
      this.deps.log(`session-host: - ${name} (gone from registry, stop pending)`)

    this.active.clear()
    for (const [name, entry] of next)
      this.active.set(name, entry)

    if (added.length || removed.length)
      this.deps.log(`session-host: now hosting ${this.active.size} agent(s)`)
    else
      this.deps.log(`session-host: reconcile no-op (${this.active.size} agent(s))`)
  }
}
