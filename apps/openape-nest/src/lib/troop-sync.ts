// Centralised troop sync — replaces per-agent
// `/Library/LaunchDaemons/openape.troop.sync.<agent>.plist` cron-loops
// with one in-Nest interval timer that walks the registry and runs
// `apes agents sync` for each agent.
//
// Why centralise: pre-Phase-C every spawn dropped a system-domain
// plist that woke up every 5 min, ran apes-cli as root, did setuid +
// HTTP to troop. n agents = n separate plists, each with its own
// crashloop window if anything went wrong (which it did — see the
// 401 storms after the auth.json key_path bug). One Nest-driven loop
// is observable in one place, batched, and can short-circuit on a
// noticeable failure pattern.

import { execFile } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'
import { listAgents } from './registry'

const execFileAsync = promisify(execFile)

const TICK_MS = 5 * 60 * 1000 // 5 min — matches the legacy StartInterval

export interface TroopSyncDeps {
  apesBin: string
  log: (line: string) => void
}

export class TroopSync {
  private timer: NodeJS.Timeout | undefined
  private inflight = false

  constructor(private deps: TroopSyncDeps) {}

  start(): void {
    if (this.timer) return
    // First tick after a small delay so the supervisor / boot
    // reconcile finishes first, then the regular interval.
    setTimeout(() => this.tick(), 30_000).unref()
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.deps.log('troop-sync: loop started (interval=5min)')
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  private async tick(): Promise<void> {
    if (this.inflight) return // skip if previous tick still running
    this.inflight = true
    try {
      const agents = listAgents()
      if (agents.length === 0) return
      this.deps.log(`troop-sync: reconciling ${agents.length} agent(s)`)
      // Run agents serially to avoid hammering the IdP / troop with
      // n parallel auth refreshes. 5 min is plenty of room.
      for (const agent of agents) {
        await this.syncOne(agent.name)
      }
    }
    finally {
      this.inflight = false
    }
  }

  private async syncOne(name: string): Promise<void> {
    try {
      // `apes run --as <agent>` triggers escapes-helper which does
      // the setuid switch and exec's `apes agents sync` as the
      // agent. The Nest's YOLO policy auto-approves the grant.
      await execFileAsync(
        this.deps.apesBin,
        ['run', '--as', name, '--wait', '--', 'apes', 'agents', 'sync'],
        { maxBuffer: 1024 * 1024, env: process.env, timeout: 60_000 },
      )
    }
    catch (err) {
      this.deps.log(`troop-sync: ${name} failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
    }
  }
}
