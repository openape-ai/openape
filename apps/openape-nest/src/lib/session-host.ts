import type { AgentEntry } from './registry'
import { readNestState } from './nest-state'
import { listAgents } from './registry'

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
  /**
   * Advance this session once — the in-process replacement for the per-agent
   * scheduler `setInterval`. The host calls this for every live session on a
   * single central tick. Optional until the runtime loop lands: the
   * placeholder omits it, making the tick a no-op for that session.
   */
  tick?: () => Promise<void>
}

export type SessionFactory = (entry: AgentEntry) => HostedSession

/**
 * A read-only snapshot of what the host wants versus what it actually runs.
 * `stranded` is `desired \ hosted` — agents the registry asks for whose
 * `start()` has not (yet) succeeded. `errored` is the subset of `hosted` whose
 * most recent `tick()` threw and has not since recovered: an agent that is live
 * (WS connected) but failing its scheduled work, which present/absent alone
 * cannot tell from a healthy one. The cutover health surface and the M2
 * acceptance check ("all 13 agents live") read this; all lists are sorted so the
 * snapshot is deterministic.
 */
export interface SessionHostStatus {
  desired: string[]
  hosted: string[]
  stranded: string[]
  errored: string[]
}

/** A live session together with the registry entry it was started from. */
interface LiveSession {
  session: HostedSession
  entry: AgentEntry
  /** Whether this session's most recent `tick()` threw (cleared on success). */
  tickFailed: boolean
}

/**
 * Two registry entries describe the same running agent when every field the
 * runtime depends on matches. `registeredAt` is excluded — it is provenance
 * metadata, not runtime config, and never changes for a live agent. Everything
 * else (email, uid, home, bridge config, kind, service) feeds the session, so a
 * change there means the session must restart to pick it up. Both entries come
 * from the same registry parse, so their key order is stable and a plain
 * serialization compares correctly.
 */
function sameAgentConfig(a: AgentEntry, b: AgentEntry): boolean {
  const { registeredAt: _a, ...restA } = a
  const { registeredAt: _b, ...restB } = b
  return JSON.stringify(restA) === JSON.stringify(restB)
}

/** Human-readable text for a thrown value, used in per-session failure logs. */
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

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
 * session started, each removed agent gets its session stopped, and an agent
 * whose registry config changed gets its session restarted. The session
 * factory is injectable (default: a no-op placeholder), so the per-agent
 * runtime loop + sudo-drop tool execution drop in without touching the host.
 */
export class SessionHost implements AgentSupervisor {
  /** Live sessions, keyed by agent name. */
  private readonly sessions = new Map<string, LiveSession>()
  /**
   * The latest desired agent set, kept so the central tick can retry an agent
   * whose `start()` failed and left it absent. `reconcile` only re-fires on a
   * registry change, so without this a stranded agent would wait for the next
   * edit; the tick gives it the in-process parallel to pm2's autorestart.
   */
  private desired = new Map<string, AgentEntry>()
  private readonly createSession: SessionFactory
  /** True while a reconcile is in flight, to serialize overlapping calls. */
  private reconciling = false
  /** Latest desired set requested while a reconcile was already running. */
  private pendingDesired: AgentEntry[] | undefined
  /**
   * The stranded set last announced by {@link tickAll}, as a stable sorted key.
   * The tick retries stranded agents every cadence, but an agent whose start
   * keeps failing would otherwise re-log the same line on every tick (every
   * 60s). Logging only when the set changes keeps the signal — you see when an
   * agent strands or recovers — without the steady-state spam. `undefined` once
   * nothing is stranded, so a later strand of the same agent logs again.
   */
  private lastStrandedKey: string | undefined

  /** Last logged pause picture (`nest` or sorted agent names), to log only on change. */
  private lastPausedKey: string | undefined

  constructor(private readonly deps: { log: (line: string) => void, createSession?: SessionFactory }) {
    this.createSession = deps.createSession ?? createPlaceholderSession
  }

  private async startSession(entry: AgentEntry): Promise<void> {
    const session = this.createSession(entry)
    await session.start()
    this.sessions.set(entry.name, { session, entry, tickFailed: false })
  }

  /**
   * Reconcile the live sessions to `desired`, serialized against itself.
   *
   * `index.ts` drives reconcile from several sources — the initial run, the
   * debounced fs.watch handler, and the 5s change-detecting poll — which can
   * overlap once `start()` does real async work (opening a WS socket). The live
   * map is only written *after* `await session.start()`, so two concurrent runs
   * would both find the same agent in `toStart` and start it twice. Only one
   * reconcile runs at a time; a request arriving mid-run is remembered (latest
   * wins — reconcile is declarative, only the newest desired state matters) and
   * replayed once the current run drains.
   */
  async reconcile(desired: AgentEntry[]): Promise<void> {
    if (this.reconciling) {
      this.pendingDesired = desired
      return
    }
    this.reconciling = true
    try {
      await this.reconcileOnce(desired)
      while (this.pendingDesired) {
        const next = this.pendingDesired
        this.pendingDesired = undefined
        await this.reconcileOnce(next)
      }
    }
    finally {
      this.reconciling = false
    }
  }

  private async reconcileOnce(desired: AgentEntry[]): Promise<void> {
    const next = new Map(desired.map(a => [a.name, a]))
    this.desired = next
    const toStart = [...next.values()].filter(entry => !this.sessions.has(entry.name))
    const toStop = [...this.sessions.values()].filter(live => !next.has(live.entry.name))
    const toRestart = [...next.values()].filter((entry) => {
      const live = this.sessions.get(entry.name)
      return live !== undefined && !sameAgentConfig(live.entry, entry)
    })

    // Each transition is isolated in its own try/catch so one agent failing to
    // start, stop or restart never aborts the reconcile for the others — the
    // same per-session resilience tickAll/stopAll already give. A failed start
    // or restart leaves the agent absent from (or unchanged in) the live map, so
    // the next reconcile naturally retries it.

    // Restart agents whose config changed (model swap, key rotation): stop the
    // stale session, then start a fresh one from the new entry. This is the
    // in-process parallel to the pm2 path rewriting ecosystem.config.js and
    // `startOrReload`ing the daemon so the change actually takes effect.
    for (const entry of toRestart) {
      const stale = this.sessions.get(entry.name)!.session
      // Drop the stale session from the live map up front: the old config must
      // never stay live past a restart attempt. On success startSession re-adds
      // it with the new entry; on any failure (stop or start throws) the agent is
      // left absent — exactly like a failed start — so tickAll and the next
      // reconcile retry it as a fresh start instead of stranding a stopped
      // session that would still be ticked.
      this.sessions.delete(entry.name)
      try {
        await stale.stop()
        await this.startSession(entry)
        this.deps.log(`session-host: ~ ${entry.name} (config changed, restarted)`)
      }
      catch (err) {
        this.deps.log(`session-host: ! ${entry.name} restart failed: ${errText(err)}`)
      }
    }

    for (const entry of toStart) {
      try {
        await this.startSession(entry)
        this.deps.log(`session-host: + ${entry.name} (started)`)
      }
      catch (err) {
        this.deps.log(`session-host: ! ${entry.name} start failed: ${errText(err)}`)
      }
    }

    // An agent gone from the registry is dropped from the live map regardless of
    // whether its stop() succeeds — there is no registry entry left to retry
    // against, so a stuck stop must not keep the session live and ticking.
    for (const live of toStop) {
      try {
        await live.session.stop()
        this.deps.log(`session-host: - ${live.entry.name} (gone from registry, stopped)`)
      }
      catch (err) {
        this.deps.log(`session-host: ! ${live.entry.name} stop failed: ${errText(err)}`)
      }
      this.sessions.delete(live.entry.name)
    }

    if (toStart.length || toStop.length || toRestart.length)
      this.deps.log(`session-host: now hosting ${this.sessions.size} agent(s)`)
    else
      this.deps.log(`session-host: reconcile no-op (${this.sessions.size} agent(s))`)
  }

  /**
   * Advance every live session once. This is the single central scheduler tick
   * that replaces the 13 per-agent `setInterval`s of the pm2 model. Each
   * session's tick is isolated in its own try/catch so one agent throwing never
   * stalls the others (the per-session resilience M2 calls for); the failure is
   * logged and the next tick retries.
   */
  async tickAll(): Promise<void> {
    // Before advancing, retry any desired agent that isn't live — e.g. a
    // transient `start()` failure left it absent. Route the retry back through
    // the already-serialized, idempotent `reconcile` rather than starting here:
    // that reuses the coalescing guard, so a tick firing during an in-flight
    // reconcile can never double-start the same agent. With placeholder
    // sessions `start()` never fails, so every desired agent is already live
    // and this is a no-op.
    const stranded = [...this.desired.values()].filter(entry => !this.sessions.has(entry.name))
    if (stranded.length) {
      // Make a stuck rollout visible: without this the retry below is silent, so
      // an agent whose start keeps failing would never surface in the nest log.
      // This is what the cutover health check ("all agents live") watches for.
      // Log only when the stranded set changes — the retry runs every tick, but
      // re-logging the same names every cadence would bury the nest log.
      const names = stranded.map(e => e.name)
      const key = [...names].sort().join(',')
      if (key !== this.lastStrandedKey) {
        this.deps.log(`session-host: ${stranded.length} agent(s) stranded, retrying: ${names.join(', ')}`)
        this.lastStrandedKey = key
      }
      await this.reconcile([...this.desired.values()])
    }
    else {
      // Nothing stranded: clear the key so a fresh strand later logs again.
      this.lastStrandedKey = undefined
    }

    // Pause skips turn execution but NOT the reconcile above: a paused agent
    // stays live + WS-connected so resume is instant. Read live each tick so a
    // pause/resume takes effect without a respawn. (Inbound-message turns funnel
    // through dispatchTurn, which guards on the same flag — this covers the
    // autonomous tick path + the nest-wide switch.)
    const nestPaused = readNestState().paused
    const pausedNames = new Set(this.sessions.size ? listAgents().filter(a => a.paused).map(a => a.name) : [])
    const pausedKey = nestPaused ? 'nest' : (pausedNames.size ? [...pausedNames].sort().join(',') : undefined)
    if (pausedKey !== this.lastPausedKey) {
      if (nestPaused) this.deps.log('session-host: ⏸ nest paused — skipping all turns')
      else if (pausedNames.size) this.deps.log(`session-host: ⏸ paused, skipping turns: ${[...pausedNames].sort().join(', ')}`)
      else this.deps.log('session-host: ▶ resumed — turns running')
      this.lastPausedKey = pausedKey
    }

    for (const live of this.sessions.values()) {
      const { session } = live
      if (!session.tick)
        continue
      if (nestPaused || pausedNames.has(session.name))
        continue
      try {
        await session.tick()
        live.tickFailed = false
      }
      catch (err) {
        live.tickFailed = true
        this.deps.log(`session-host: ! ${session.name} tick failed: ${errText(err)}`)
      }
    }
  }

  /**
   * Stop every live session — the process-shutdown counterpart to
   * {@link reconcile}'s per-agent stop. The nest calls this on SIGTERM/SIGINT
   * so that once sessions hold real resources (WS sockets, runtime loops) they
   * close cleanly instead of being killed mid-flight. Each stop is isolated in
   * its own try/catch so one session failing to stop never blocks the others;
   * the map is cleared regardless so the host ends up with no live sessions.
   */
  async stopAll(): Promise<void> {
    for (const { session } of this.sessions.values()) {
      try {
        await session.stop()
      }
      catch (err) {
        this.deps.log(`session-host: ! ${session.name} stop failed: ${errText(err)}`)
      }
    }
    const count = this.sessions.size
    this.sessions.clear()
    this.deps.log(`session-host: stopped all ${count} session(s)`)
  }

  /**
   * A read-only snapshot of desired vs. live agents. `stranded` lists desired
   * agents that are not live — an agent whose `start()` failed and is waiting
   * for the next tick/reconcile retry. `errored` lists hosted agents whose most
   * recent tick threw — live but failing their scheduled work. Pure observation:
   * it mutates nothing and is what a nest health surface (and the cutover check
   * that all agents are live) reads to tell a healthy host from one with stuck
   * starts or silently failing ticks.
   */
  status(): SessionHostStatus {
    const desired = [...this.desired.keys()].sort()
    const hosted = [...this.sessions.keys()].sort()
    const stranded = desired.filter(name => !this.sessions.has(name))
    const errored = [...this.sessions.values()]
      .filter(live => live.tickFailed)
      .map(live => live.entry.name)
      .sort()
    return { desired, hosted, stranded, errored }
  }
}
