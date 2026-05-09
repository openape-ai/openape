// Process supervisor — spawns one chat-bridge child per registered
// agent, restarts on crash with bounded backoff. Replaces per-agent
// launchd plists.
//
// How the uid switch works: the nest itself runs as the human user,
// each agent has its own macOS uid. We use `apes run --as <agent>`
// which goes through the existing escapes-helper (already root-
// trusted, validates the always-grant the human approved at
// `apes nest install` time). Lazy-spawned: kicks in when the
// supervisor sees the entry in the registry.

import { spawn  } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { AgentEntry } from './registry'

interface Supervised {
  child: ChildProcess
  consecutiveCrashes: number
  startedAt: number
  /** Timer for the next restart attempt; cleared on stop or successful exit. */
  restartTimer?: NodeJS.Timeout
}

const MIN_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 60_000

export interface SupervisorDeps {
  /** Path to the apes binary used for the `apes run --as` invocation. */
  apesBin: string
  log: (line: string) => void
}

export class Supervisor {
  private children = new Map<string, Supervised>()

  constructor(private deps: SupervisorDeps) {}

  /**
   * Bring the supervised set in line with the desired set. Spawns
   * agents that aren't running, kills agents that are no longer in
   * the registry. Idempotent — call after every registry mutation.
   */
  reconcile(desired: AgentEntry[]): void {
    const desiredNames = new Set(desired.map(a => a.name))
    // Stop children for agents no longer in the registry.
    for (const [name] of this.children) {
      if (!desiredNames.has(name)) this.stop(name)
    }
    // Start children for agents that should be running.
    for (const agent of desired) {
      if (!this.children.has(agent.name)) this.start(agent)
    }
  }

  /** Number of currently-running supervised processes. */
  size(): number {
    return this.children.size
  }

  /** Snapshot of supervised state — useful for /agents GET. */
  status(): Array<{ name: string, pid: number, uptimeSec: number, consecutiveCrashes: number }> {
    const now = Date.now()
    return Array.from(this.children.entries()).map(([name, s]) => ({
      name,
      pid: s.child.pid ?? -1,
      uptimeSec: Math.floor((now - s.startedAt) / 1000),
      consecutiveCrashes: s.consecutiveCrashes,
    }))
  }

  start(agent: AgentEntry): void {
    if (this.children.has(agent.name)) return
    this.deps.log(`supervisor: starting ${agent.name}`)
    this.spawnChild(agent, 0)
  }

  stop(name: string): void {
    const s = this.children.get(name)
    if (!s) return
    this.deps.log(`supervisor: stopping ${name}`)
    if (s.restartTimer) clearTimeout(s.restartTimer)
    this.children.delete(name)
    try { s.child.kill('SIGTERM') }
    catch { /* already gone */ }
  }

  /** Kill all children — called on daemon shutdown. */
  stopAll(): void {
    for (const name of Array.from(this.children.keys())) this.stop(name)
  }

  private spawnChild(agent: AgentEntry, prevCrashes: number): void {
    // The bridge picks up its config (LITELLM_*, system prompt, model
    // overrides) from $HOME/Library/Application Support/openape/bridge/.env
    // — same file `apes agents spawn --bridge` writes today. Nothing
    // changes inside the bridge process itself.
    // `apes run` automatically reuses an existing always/timed grant
    // that matches the command pattern (see findExistingGrant). The
    // human approves the always-grant once during `apes nest install`;
    // every supervisor restart from then on is silent (no human prompt).
    const args = ['run', '--as', agent.name, '--', 'openape-chat-bridge']
    const child = spawn(this.deps.apesBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })

    child.stdout?.on('data', chunk => this.forwardLog(agent.name, 'stdout', chunk))
    child.stderr?.on('data', chunk => this.forwardLog(agent.name, 'stderr', chunk))

    const supervised: Supervised = {
      child,
      consecutiveCrashes: prevCrashes,
      startedAt: Date.now(),
    }
    this.children.set(agent.name, supervised)

    child.on('exit', (code, signal) => {
      const stillManaged = this.children.get(agent.name) === supervised
      if (!stillManaged) return // stopped intentionally; caller already removed

      const ranLongEnough = Date.now() - supervised.startedAt > 30_000
      const nextCrashes = ranLongEnough ? 1 : prevCrashes + 1
      const backoff = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** Math.max(0, nextCrashes - 1))
      this.deps.log(
        `supervisor: ${agent.name} exited code=${code} signal=${signal ?? 'none'} `
        + `consecutive=${nextCrashes} → respawn in ${backoff}ms`,
      )
      supervised.restartTimer = setTimeout(() => {
        // Race: a stop() between now and the timer firing would have
        // deleted us — guard one more time.
        if (this.children.get(agent.name) !== supervised) return
        this.children.delete(agent.name)
        this.spawnChild(agent, nextCrashes)
      }, backoff)
    })
  }

  private forwardLog(name: string, stream: 'stdout' | 'stderr', chunk: Buffer): void {
    // One line at a time — chat-bridge already prefixes with ISO ts,
    // we add the agent name so a single nest log can serve all.
    const text = chunk.toString('utf8')
    for (const line of text.split('\n')) {
      const trimmed = line.trimEnd()
      if (!trimmed) continue
      this.deps.log(`[${name}/${stream}] ${trimmed}`)
    }
  }
}
