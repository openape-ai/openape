// WebSocket client to the troop control-plane endpoint
// (`wss://troop.openape.ai/api/nest-ws`). Connects on boot, keeps the
// connection alive with 30s heartbeats, reconnects with exponential
// backoff when troop disappears, and routes inbound frames to the
// right handler:
//
//   config-update { agent_email }   → re-sync the named agent
//                                     (`apes run --as <name> -- apes agents sync`).
//                                     YOLO-allowed, no Patrick-prompt.
//   spawn-intent  { intent_id, ... } → run `apes agents spawn …` and
//                                     report success/failure back via
//                                     `spawn-result` (this is the only
//                                     intent type that triggers a DDISA
//                                     push to Patrick's iPhone — the
//                                     usual grant cycle).
//   reload-bridge { name }          → pm2 reload openape-bridge-<name>,
//                                     no sync (used after manual
//                                     agent.json edits in rare cases).
//
// The 5-min `troop-sync.ts` polling loop stays running in parallel as
// a cold-path fallback for whenever the WS connection is down (Mac
// sleeping, troop deploying, flaky network).

import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { hostname, networkInterfaces } from 'node:os'
import { ensureFreshIdpAuth, NotLoggedInError } from '@openape/cli-auth'
import WebSocket from 'ws'

const HEARTBEAT_INTERVAL_MS = 30_000
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

interface SpawnIntentFrame {
  type: 'spawn-intent'
  intent_id: string
  name: string
  bridge?: { key?: string, base_url?: string, model?: string }
  soul?: string
  skills?: Array<{ name: string, description: string, body: string }>
}

interface ConfigUpdateFrame {
  type: 'config-update'
  agent_email: string
}

interface ReloadBridgeFrame {
  type: 'reload-bridge'
  name: string
}

type InboundFrame = SpawnIntentFrame | ConfigUpdateFrame | ReloadBridgeFrame | { type: string }

export interface TroopWsOptions {
  /** Default: `wss://troop.openape.ai`. Override via env `OPENAPE_TROOP_WS_URL`. */
  troopUrl?: string
  apesBin: string
  log: (line: string) => void
  /**
   * package.json version of @openape/nest — surfaces in the troop UI's
   *  online-badge tooltip and in audit logs.
   */
  version?: string
}

export class TroopWs {
  private socket: WebSocket | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempts = 0
  private stopped = false
  private readonly troopUrl: string
  private readonly hostId: string
  private readonly hostname: string

  constructor(private opts: TroopWsOptions) {
    this.troopUrl = (opts.troopUrl ?? process.env.OPENAPE_TROOP_WS_URL ?? 'wss://troop.openape.ai').replace(/\/$/, '')
    this.hostId = readHostId()
    this.hostname = hostname()
  }

  start(): void {
    this.stopped = false
    void this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.reconnectTimer = null
    this.heartbeatTimer = null
    if (this.socket) {
      try { this.socket.close() }
      catch { /* already closed */ }
      this.socket = null
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return
    let token: string
    try {
      const auth = await ensureFreshIdpAuth()
      token = auth.access_token
    }
    catch (err) {
      if (err instanceof NotLoggedInError) {
        this.opts.log('troop-ws: not logged in (apes login) — skip connect, will retry')
      }
      else {
        this.opts.log(`troop-ws: auth refresh failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      this.scheduleReconnect()
      return
    }

    const url = `${this.troopUrl}/api/nest-ws?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(url)
    this.socket = ws

    ws.on('open', () => {
      this.reconnectAttempts = 0
      this.opts.log(`troop-ws: connected to ${this.troopUrl}`)
      ws.send(JSON.stringify({
        type: 'hello',
        host_id: this.hostId,
        hostname: this.hostname,
        version: this.opts.version ?? 'unknown',
      }))
      this.heartbeatTimer = setInterval(() => {
        try { ws.send(JSON.stringify({ type: 'heartbeat' })) }
        catch { /* socket closed mid-tick; close handler will reconnect */ }
      }, HEARTBEAT_INTERVAL_MS)
    })

    ws.on('message', (data: WebSocket.RawData) => {
      const text = typeof data === 'string'
        ? data
        : Buffer.isBuffer(data) ? data.toString('utf8') : ''
      if (!text) return
      let frame: InboundFrame
      try { frame = JSON.parse(text) as InboundFrame }
      catch { return }
      this.handleFrame(frame).catch((err) => {
        this.opts.log(`troop-ws: frame handler error: ${err instanceof Error ? err.message : String(err)}`)
      })
    })

    ws.on('close', (code, reason) => {
      this.opts.log(`troop-ws: disconnected (${code}${reason.length > 0 ? ` ${reason.toString()}` : ''}) — reconnecting`)
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = null
      }
      this.socket = null
      this.scheduleReconnect()
    })

    ws.on('error', (err) => {
      this.opts.log(`troop-ws: socket error: ${err.message}`)
      // close handler also fires; let it schedule the reconnect.
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    if (this.reconnectTimer) return
    const attempt = Math.min(this.reconnectAttempts, 5)
    this.reconnectAttempts++
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delay)
  }

  private async handleFrame(frame: InboundFrame): Promise<void> {
    if (frame.type === 'welcome') {
      // ack from troop after auth — nothing to do.
      return
    }
    if (frame.type === 'ack') {
      // server-ack for hello frame — nothing to do.
      return
    }
    if (frame.type === 'config-update') {
      await this.handleConfigUpdate(frame as ConfigUpdateFrame)
      return
    }
    if (frame.type === 'spawn-intent') {
      await this.handleSpawnIntent(frame as SpawnIntentFrame)
      return
    }
    if (frame.type === 'reload-bridge') {
      await this.handleReloadBridge(frame as ReloadBridgeFrame)
    }
    // Unknown frame types: ignore. Forward-compat for future troop
    // versions that send frames an older nest doesn't recognize.
  }

  private async handleConfigUpdate(frame: ConfigUpdateFrame): Promise<void> {
    // Map agent_email → local agent slug (the part before '+'/'-'-hash).
    // We use the same convention agents/sync.ts has: `<name>-<hash>+<owner-local>+<owner-domain>@<idp>`.
    const local = frame.agent_email.split('+')[0]
    if (!local) return
    const dash = local.lastIndexOf('-')
    const name = dash > 0 ? local.slice(0, dash) : local
    this.opts.log(`troop-ws: config-update for ${name} — running sync`)
    await this.runApes(['run', '--as', name, '--wait', '--', 'apes', 'agents', 'sync'], `config-update sync ${name}`)
  }

  private async handleSpawnIntent(frame: SpawnIntentFrame): Promise<void> {
    this.opts.log(`troop-ws: spawn-intent ${frame.name} (intent ${frame.intent_id})`)
    const args = ['agents', 'spawn', frame.name]
    if (frame.bridge?.key) args.push('--bridge-key', frame.bridge.key)
    if (frame.bridge?.base_url) args.push('--bridge-base-url', frame.bridge.base_url)
    if (frame.bridge?.model) args.push('--bridge-model', frame.bridge.model)
    try {
      const { stdout } = await runWithCapture(this.opts.apesBin, args)
      // Parse the spawned agent email out of the spawn output line:
      //   "✔ Registered as <email>"
      const match = stdout.match(/Registered as\s+(\S+@\S+)/)
      const agentEmail = match?.[1]
      this.opts.log(`troop-ws: spawn-result ${frame.name} ok agent=${agentEmail ?? '?'}`)
      this.send({ type: 'spawn-result', intent_id: frame.intent_id, ok: true, agent_email: agentEmail })
    }
    catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      this.opts.log(`troop-ws: spawn-result ${frame.name} FAIL: ${error}`)
      this.send({ type: 'spawn-result', intent_id: frame.intent_id, ok: false, error })
    }
  }

  private async handleReloadBridge(frame: ReloadBridgeFrame): Promise<void> {
    this.opts.log(`troop-ws: reload-bridge ${frame.name}`)
    await this.runApes(
      ['run', '--as', frame.name, '--wait', '--', 'pm2', 'reload', `openape-bridge-${frame.name}`, '--update-env'],
      `reload-bridge ${frame.name}`,
    )
  }

  private async runApes(args: string[], label: string): Promise<void> {
    try { await runWithCapture(this.opts.apesBin, args) }
    catch (err) {
      this.opts.log(`troop-ws: ${label} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private send(frame: Record<string, unknown>): void {
    const ws = this.socket
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    try { ws.send(JSON.stringify(frame)) }
    catch (err) {
      this.opts.log(`troop-ws: send failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

function runWithCapture(bin: string, args: string[]): Promise<{ stdout: string, stderr: string }> {
  return new Promise((resolve, reject) => {
    // `apes agents spawn` ends up starting a pm2 daemon for the new
    // agent, and pm2 inherits stdio FDs from its parent chain. Node's
    // execFile won't resolve until those FDs close — so without a
    // timeout the promise hangs forever even though the spawn is
    // already "done" from the user's POV. troop-sync uses the same
    // 60s cap for the same reason. We bump to 120s here because
    // first-time spawns also have an npm-install step.
    execFile(bin, args, { maxBuffer: 4 * 1024 * 1024, timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) {
        // `signal: 'SIGTERM'` means we hit the timeout. Treat that as
        // "spawn likely succeeded but stdio never closed" — caller
        // verifies via the agent's troop-sync result anyway.
        const isTimeout = (err as { signal?: string }).signal === 'SIGTERM'
        if (isTimeout) {
          resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
          return
        }
        const msg = stderr.toString() || err.message
        reject(new Error(msg.split('\n').filter(Boolean).slice(-3).join(' / ')))
        return
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
    })
  })
}

/**
 * Stable per-host identifier. On macOS we read `IOPlatformUUID` via
 * ioreg if available (same source `apes agents sync` pins on). As a
 * portable fallback we hash MAC addresses + hostname — gives a stable
 * value across boots on Linux/CI without requiring elevated privs.
 */
function readHostId(): string {
  try {
    if (process.platform === 'darwin') {
      const out = execFileSync('/usr/sbin/ioreg', ['-d2', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' })
      const match = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)
      if (match) return match[1]!
    }
  }
  catch { /* fall through to hash-based id */ }
  return hashBasedHostId()
}

function hashBasedHostId(): string {
  const nics = networkInterfaces()
  const macs: string[] = []
  for (const list of Object.values(nics)) {
    if (!list) continue
    for (const nic of list) {
      if (!nic.mac || nic.mac === '00:00:00:00:00:00' || nic.internal) continue
      macs.push(nic.mac)
    }
  }
  const seed = `${hostname()}|${macs.toSorted().join(',')}`
  return createHash('sha256').update(seed).digest('hex').slice(0, 32)
}

// Read this package's version once at boot. Falls back to 'unknown'
// when the dist/ layout puts package.json out of reach (tests).
export function readNestVersion(): string {
  try {
    const root = new URL('../../package.json', import.meta.url)
    const pkg = JSON.parse(readFileSync(root, 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : 'unknown'
  }
  catch { return 'unknown' }
}
