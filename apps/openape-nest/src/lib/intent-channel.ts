// Intent channel — replaces the HTTP API on 127.0.0.1:9091.
//
// Goal: the Nest stops being a server. Callers (apes-cli) drop a JSON
// intent file into a shared directory; the Nest polls the directory,
// executes the intent, writes a response file back, and removes the
// intent file. The CLI polls for the response.
//
// Why the file-system instead of HTTP / IdP grants:
//   * No HTTP server in the Nest → matches Patrick's "long-running
//     client" model.
//   * No DDISA grants per intent → spawn doesn't burn a grant per call
//     (which was a problem since humans have no YOLO and would have
//     been re-approved for every spawn).
//   * UNIX permissions are the gate: directory mode 770, group
//     _openape_nest. Only Patrick (member of that group) and the
//     Nest itself can drop intents. Anyone with shell access as
//     Patrick can already do `apes run --as root --` so this isn't
//     a security regression.
//
// Wire format (one file per intent in INTENTS_DIR/<uuid>.json):
//   intent: { id, action: 'spawn'|'destroy', name, bridge?, … }
//   response (written to INTENTS_DIR/<uuid>.response):
//     { ok: true, result: {...} }  or  { ok: false, error: 'msg' }
//
// CLI poll loop tails INTENTS_DIR for `<id>.response`, deletes it
// after read. Nest deletes processed intents to avoid replay.

import { readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { handleAgentSpawn, handleAgentDestroy } from '../api/agents'
import { listAgents } from './registry'
import type { Pm2Supervisor } from './pm2-supervisor'

const POLL_MS = 1_000

export interface IntentChannelDeps {
  apesBin: string
  supervisor: Pm2Supervisor
  log: (line: string) => void
}

interface SpawnIntent {
  id: string
  action: 'spawn'
  name: string
  bridge?: boolean
  bridgeKey?: string
  bridgeBaseUrl?: string
  bridgeModel?: string
}

interface DestroyIntent {
  id: string
  action: 'destroy'
  name: string
}

interface ListIntent {
  id: string
  action: 'list'
}

type Intent = SpawnIntent | DestroyIntent | ListIntent

export const INTENTS_DIR = join(homedir(), 'intents')

export class IntentChannel {
  private timer: NodeJS.Timeout | undefined
  private inflight = new Set<string>()

  constructor(private deps: IntentChannelDeps) {
    mkdirSync(INTENTS_DIR, { recursive: true })
    chmodSync(INTENTS_DIR, 0o770)
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), POLL_MS)
    this.deps.log(`intent-channel: polling ${INTENTS_DIR}`)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  private async tick(): Promise<void> {
    let entries: string[]
    try { entries = readdirSync(INTENTS_DIR) }
    catch { return }
    for (const f of entries) {
      if (!f.endsWith('.json')) continue
      if (this.inflight.has(f)) continue
      this.inflight.add(f)
      void this.process(f).finally(() => this.inflight.delete(f))
    }
  }

  private async process(filename: string): Promise<void> {
    const path = join(INTENTS_DIR, filename)
    let intent: Intent
    try {
      const raw = readFileSync(path, 'utf8')
      intent = JSON.parse(raw) as Intent
    }
    catch (err) {
      this.deps.log(`intent-channel: failed to read ${filename}: ${err instanceof Error ? err.message : String(err)}`)
      try { unlinkSync(path) }
      catch { /* gone */ }
      return
    }

    this.deps.log(`intent-channel: processing ${intent.action} (id=${intent.id})`)
    let response: { ok: true, result: unknown } | { ok: false, error: string }
    try {
      const ctx = {
        url: new URL('intent:/'),
        body: intent as unknown,
        log: this.deps.log,
        apesBin: this.deps.apesBin,
        caller: '<intent-channel>',
        grantId: intent.id,
        supervisor: this.deps.supervisor,
      }
      let result: unknown
      switch (intent.action) {
        case 'spawn':
          result = await handleAgentSpawn(ctx)
          break
        case 'destroy':
          result = await handleAgentDestroy(ctx, intent.name)
          break
        case 'list':
          result = { agents: listAgents() }
          break
        default:
          throw new Error(`unknown action: ${(intent as { action?: string }).action ?? '<undefined>'}`)
      }
      response = { ok: true, result }
    }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.deps.log(`intent-channel: ${intent.action} failed: ${msg}`)
      response = { ok: false, error: msg }
    }

    // Atomic write: write to .response.tmp then rename, so the CLI
    // never reads a half-written file.
    const respTmp = `${path.replace(/\.json$/, '')}.response.tmp`
    const respFinal = `${path.replace(/\.json$/, '')}.response`
    writeFileSync(respTmp, `${JSON.stringify(response)}\n`, { mode: 0o660 })
    renameSync(respTmp, respFinal)

    // Remove the intent file so we don't reprocess.
    try { unlinkSync(path) }
    catch { /* gone — fine */ }
  }
}

/** Reaper for stale response files (>1h old). Best-effort. */
export function reapStaleResponses(log: (line: string) => void): void {
  let entries: string[]
  try { entries = readdirSync(INTENTS_DIR) }
  catch { return }
  const now = Date.now()
  for (const f of entries) {
    if (!f.endsWith('.response')) continue
    const path = join(INTENTS_DIR, f)
    try {
      const st = statSync(path)
      if (now - st.mtimeMs > 60 * 60 * 1000) {
        unlinkSync(path)
        log(`intent-channel: reaped stale ${f}`)
      }
    }
    catch { /* gone */ }
  }
}
