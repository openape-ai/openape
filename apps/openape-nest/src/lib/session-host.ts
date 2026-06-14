import type { AgentEntry } from './registry'

/**
 * Common contract for the nest's agent supervisor, so `index.ts` can swap
 * implementations behind a flag without caring which one runs.
 */
export interface AgentSupervisor {
  reconcile: (desired: AgentEntry[]) => Promise<void>
}

/**
 * One hosted agent's lifecycle as the SessionHost sees it. The per-agent
 * runtime (WS loop + scheduler + sudo-drop tool execution) plugs in behind
 * this seam without the host changing. Until that lands the default
 * implementation ({@link createPlaceholderSession}) is a no-op, so the flag
 * path stays non-breaking.
 */
export interface HostedSession {
  readonly name: string
  start: () => Promise<void>
  stop: () => Promise<void>
}

export type SessionFactory = (entry: AgentEntry) => HostedSession

/**
 * Placeholder session: runs nothing, opens no socket. Keeps the in-process
 * path behaviourally identical to "flag off" until the real runtime loop
 * replaces it.
 */
function createPlaceholderSession(entry: AgentEntry): HostedSession {
  return {
    name: entry.name,
    async start() {},
    async stop() {},
  }
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
 * pm2 path is untouched. This increment turns the desired agent set into
 * real {@link HostedSession} lifecycle calls: each added agent gets a
 * session started, each removed agent gets its session stopped. The session
 * factory is injectable (default: a no-op placeholder), so the per-agent
 * runtime loop + sudo-drop tool execution drop in without touching the host.
 */
export class SessionHost implements AgentSupervisor {
  /** Live sessions, keyed by agent name. */
  private readonly sessions = new Map<string, HostedSession>()
  private readonly createSession: SessionFactory

  constructor(private readonly deps: { log: (line: string) => void, createSession?: SessionFactory }) {
    this.createSession = deps.createSession ?? createPlaceholderSession
  }

  async reconcile(desired: AgentEntry[]): Promise<void> {
    const next = new Map(desired.map(a => [a.name, a]))
    const toStart = [...next.values()].filter(entry => !this.sessions.has(entry.name))
    const toStop = [...this.sessions.values()].filter(session => !next.has(session.name))

    for (const entry of toStart) {
      const session = this.createSession(entry)
      await session.start()
      this.sessions.set(entry.name, session)
      this.deps.log(`session-host: + ${entry.name} (started)`)
    }

    for (const session of toStop) {
      await session.stop()
      this.sessions.delete(session.name)
      this.deps.log(`session-host: - ${session.name} (gone from registry, stopped)`)
    }

    if (toStart.length || toStop.length)
      this.deps.log(`session-host: now hosting ${this.sessions.size} agent(s)`)
    else
      this.deps.log(`session-host: reconcile no-op (${this.sessions.size} agent(s))`)
  }
}
