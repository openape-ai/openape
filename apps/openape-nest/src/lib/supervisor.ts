// Process supervisor — spawns one chat-bridge child per registered
// agent, restarts on exit with bounded backoff.
//
// Replaces the system-domain LaunchDaemon-per-agent (`/Library/
// LaunchDaemons/eco.hofmann.apes.bridge.<agent>.plist`) so the whole
// agent lifecycle now sits inside one Nest process supervised by a
// single launchd entry. Each child is `apes run --as <agent> --wait
// -- openape-chat-bridge`; the `apes run` wrapper drives escapes-
// helper for the privileged setuid switch (root-trusted), the
// chat-bridge then runs as the agent's macOS uid.
//
// Why this re-introduces a class deleted in PR #365: the previous
// supervisor crashlooped on PATH inheritance (the agent's `~/.bun/
// bin/openape-chat-bridge` wasn't on the supervisor's PATH). PR #376
// retired bun-per-agent in favour of host-resolved binaries — both
// the supervisor process and the apes-run subprocess now find
// `openape-chat-bridge` on the standard host PATH (`/opt/homebrew/
// bin`), so the previous failure mode is gone.

import { spawn } from 'node:child_process'
import process from 'node:process'
import type { ChildProcess } from 'node:child_process'
import type { AgentEntry } from './registry'

interface Supervised {
  child: ChildProcess
  consecutiveCrashes: number
  startedAt: number
  restartTimer?: NodeJS.Timeout
}

const MIN_BACKOFF_MS = 2_000
const MAX_BACKOFF_MS = 60_000
const STABLE_RUNTIME_MS = 30_000

export interface SupervisorDeps {
  /** Path to the apes binary used for `apes run --as <agent>` invocations. */
  apesBin: string
  log: (line: string) => void
}

export class Supervisor {
  private children = new Map<string, Supervised>()

  constructor(private deps: SupervisorDeps) {}

  /** Bring the supervised set in line with the desired set. */
  reconcile(desired: AgentEntry[]): void {
    const desiredNames = new Set(desired.filter(a => a.bridge != null).map(a => a.name))
    for (const [name] of this.children) {
      if (!desiredNames.has(name)) this.stop(name)
    }
    for (const agent of desired) {
      if (agent.bridge == null) continue
      if (!this.children.has(agent.name)) this.start(agent)
    }
  }

  size(): number {
    return this.children.size
  }

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
    this.deps.log(`supervisor: starting bridge for ${agent.name}`)
    this.spawnChild(agent, 0)
  }

  stop(name: string): void {
    const s = this.children.get(name)
    if (!s) return
    this.deps.log(`supervisor: stopping bridge for ${name}`)
    if (s.restartTimer) clearTimeout(s.restartTimer)
    this.children.delete(name)
    try { s.child.kill('SIGTERM') }
    catch { /* already gone */ }
  }

  stopAll(): void {
    for (const name of Array.from(this.children.keys())) this.stop(name)
  }

  private spawnChild(agent: AgentEntry, prevCrashes: number): void {
    // `--wait` is mandatory: even though YOLO auto-approves the
    // grant server-side, `apes run` without `--wait` returns exit 75
    // (EX_TEMPFAIL) the moment the grant is created — before the
    // CLI observes the approval.
    const args = ['run', '--as', agent.name, '--wait', '--', 'openape-chat-bridge']
    const child = spawn(this.deps.apesBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      // Inherit env — most importantly PATH (host bin dirs from
      // captureHostBinDirs at install time) and HOME (the Nest's
      // data dir, where its own auth.json lives so apes-cli reads
      // the nest identity for the YOLO grant).
      env: process.env,
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
      if (!stillManaged) return // stopped intentionally

      const ranLongEnough = Date.now() - supervised.startedAt > STABLE_RUNTIME_MS
      const nextCrashes = ranLongEnough ? 1 : prevCrashes + 1
      const backoff = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** Math.max(0, nextCrashes - 1))
      this.deps.log(
        `supervisor: ${agent.name} bridge exited code=${code} signal=${signal ?? 'none'} `
        + `consecutive=${nextCrashes} → respawn in ${backoff}ms`,
      )
      supervised.restartTimer = setTimeout(() => {
        if (this.children.get(agent.name) !== supervised) return
        this.children.delete(agent.name)
        this.spawnChild(agent, nextCrashes)
      }, backoff)
    })
  }

  private forwardLog(name: string, stream: 'stdout' | 'stderr', chunk: Buffer): void {
    const text = chunk.toString('utf8')
    for (const line of text.split('\n')) {
      const trimmed = line.trimEnd()
      if (!trimmed) continue
      this.deps.log(`[${name}/${stream}] ${trimmed}`)
    }
  }
}
