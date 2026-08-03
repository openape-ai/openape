import type { ChildProcess } from 'node:child_process'
import type { RequestListener, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

// Shared E2E server lifecycle: one place that knows how to boot a server for a
// test suite (spawned `nuxt dev` or an in-process node listener), pick a free
// port, poll a readiness URL, and tear the server down again with process-group
// kill escalation.
//
// Crash safety (IURIO bucket-tracker pattern): every spawned server and every
// temp dir is recorded in an append-only JSONL tracker file under the OS
// tmpdir. The next run cleans up leftovers of runs whose test process is gone —
// killing a recorded pid only when its live command line still matches what we
// started (never blind), and removing only temp dirs we created ourselves.

const TRACKER_DIR = join(tmpdir(), 'openape-e2e-lifecycle')
const TRACKER_FILE = join(TRACKER_DIR, 'servers.jsonl')
const LOCK_DIR = join(TRACKER_DIR, 'lock')
const LOCK_STALE_MS = 10_000
const LOG_CAP = 256 * 1024
const POLL_INTERVAL_MS = 250
const DEFAULT_READY_TIMEOUT_MS = 120_000
const STOP_GRACE_MS = 3_000

export interface ServerStartEntry {
  kind: 'start'
  pid: number
  runnerPid: number
  command: string[]
  port: number
  startedAt: number
}

export interface ServerStopEntry {
  kind: 'stop'
  pid: number
  runnerPid: number
}

export interface TempDirEntry {
  kind: 'tempdir'
  dir: string
  runnerPid: number
}

export type TrackerEntry = ServerStartEntry | ServerStopEntry | TempDirEntry

export interface RunningServer {
  url: string
  port: number
  /** Captured stdout+stderr tail of the spawned process. */
  logs: () => string
  stop: () => Promise<void>
}

export interface StartServerOptions {
  /** Working directory the server command is spawned in. */
  cwd: string
  /** Command to spawn; defaults to `pnpm exec nuxt dev --port <port> --host <host>`. */
  command?: (ctx: { port: number, host: string }) => string[]
  /** Extra environment (merged over process.env); may derive from the chosen url/port. */
  env?: Record<string, string | undefined> | ((ctx: { url: string, port: number }) => Record<string, string | undefined>)
  /** Path polled until it responds 2xx, e.g. `/api/health`. */
  readyPath: string
  timeoutMs?: number
  /** Fixed port; a free one is picked when omitted. */
  port?: number
  host?: string
}

function withTrackerLock<T>(fn: () => T): T {
  mkdirSync(TRACKER_DIR, { recursive: true })
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      mkdirSync(LOCK_DIR)
      break
    }
    catch {
      // Steal locks left behind by a crashed process.
      try {
        if (Date.now() - statSync(LOCK_DIR).mtimeMs > LOCK_STALE_MS) {
          rmSync(LOCK_DIR, { recursive: true, force: true })
          continue
        }
      }
      catch {}
      const wait = new Int32Array(new SharedArrayBuffer(4))
      Atomics.wait(wait, 0, 0, 50)
    }
  }
  try {
    return fn()
  }
  finally {
    rmSync(LOCK_DIR, { recursive: true, force: true })
  }
}

function appendTrackerEntry(entry: TrackerEntry, file = TRACKER_FILE): void {
  withTrackerLock(() => {
    appendFileSync(file, `${JSON.stringify(entry)}\n`)
  })
}

export function readTrackerEntries(file = TRACKER_FILE): TrackerEntry[] {
  let raw = ''
  try {
    raw = readFileSync(file, 'utf-8')
  }
  catch {
    return []
  }
  return raw
    .split('\n')
    .filter(line => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as TrackerEntry]
      }
      catch {
        return []
      }
    })
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch {
    return false
  }
}

/** Live command line of a pid, or null when the process is gone / unreadable. */
function commandLineOf(pid: number): string | null {
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf-8').split('\0').join(' ').trim()
    if (cmdline)
      return cmdline
  }
  catch {}
  const res = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf-8' })
  if (res.status !== 0)
    return null
  return res.stdout.trim() || null
}

/** True when the live command line still looks like the command we spawned. */
function commandMatches(live: string, command: string[]): boolean {
  const full = command.join(' ')
  // The spawned binary may appear with an absolute path (e.g. node .../pnpm),
  // so also accept a match on everything after the binary name.
  const rest = command.slice(1).join(' ')
  return live.includes(full) || (rest.length > 0 && live.includes(rest))
}

function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  }
  catch {
    try {
      process.kill(pid, signal)
    }
    catch {}
  }
}

/**
 * Clean up servers and temp dirs left behind by earlier crashed runs: entries
 * whose runner (test process) is dead. A recorded pid is only killed when its
 * current command line still matches the recorded command — never blind.
 */
export function cleanupStaleEntries(file = TRACKER_FILE): void {
  withTrackerLock(() => {
    const entries = readTrackerEntries(file)
    if (entries.length === 0)
      return

    const stoppedPids = new Set(entries.filter(e => e.kind === 'stop').map(e => e.pid))
    for (const entry of entries) {
      if (isPidAlive(entry.runnerPid))
        continue
      if (entry.kind === 'start' && !stoppedPids.has(entry.pid)) {
        const live = commandLineOf(entry.pid)
        if (live && commandMatches(live, entry.command))
          killProcessGroup(entry.pid, 'SIGKILL')
      }
      if (entry.kind === 'tempdir' && entry.dir.startsWith(tmpdir()))
        rmSync(entry.dir, { recursive: true, force: true })
    }

    const retained = entries.filter(e => isPidAlive(e.runnerPid))
    writeFileSync(file, retained.map(e => `${JSON.stringify(e)}\n`).join(''))
  })
}

let cleanupDone = false
function cleanupOncePerProcess(): void {
  if (cleanupDone)
    return
  cleanupDone = true
  cleanupStaleEntries()
}

/** Ask the OS for a currently free TCP port. */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo
      probe.close(err => err ? reject(err) : resolve(port))
    })
  })
}

/** Create a tracked temp dir; stale ones are removed on the next run. */
export function makeTempDir(prefix: string): string {
  cleanupOncePerProcess()
  const dir = mkdtempSync(join(tmpdir(), prefix))
  appendTrackerEntry({ kind: 'tempdir', dir, runnerPid: process.pid })
  return dir
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null)
    return true
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs, false)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

/**
 * Spawn a dev server (own process group), poll `readyPath` until healthy, and
 * return a handle with SIGTERM→SIGKILL teardown. The spawn is recorded in the
 * crash tracker so an aborted run gets cleaned up by the next one.
 */
export async function startServer(opts: StartServerOptions): Promise<RunningServer> {
  cleanupOncePerProcess()
  const host = opts.host ?? '127.0.0.1'
  const port = opts.port ?? await getFreePort()
  const url = `http://${host}:${port}`
  const command = opts.command?.({ port, host })
    ?? ['pnpm', 'exec', 'nuxt', 'dev', '--port', String(port), '--host', host]
  const extraEnv = typeof opts.env === 'function' ? opts.env({ url, port }) : opts.env

  const child = spawn(command[0], command.slice(1), {
    cwd: opts.cwd,
    detached: true, // own process group → the whole tree dies on stop()
    stdio: ['ignore', 'pipe', 'pipe'],
    // Concurrent `nuxt dev` servers would fight over vite's fixed HMR port
    // 24678 and the loser never becomes ready (runs 3253/3255). Derive a
    // unique HMR port from the app port, which is already unique per server.
    env: { ...process.env, E2E_HMR_PORT: String(port + 10_000), ...extraEnv },
  })

  let logBuffer = ''
  const capture = (chunk: Buffer): void => {
    logBuffer = (logBuffer + chunk.toString()).slice(-LOG_CAP)
  }
  child.stdout?.on('data', capture)
  child.stderr?.on('data', capture)
  const logs = (): string => logBuffer

  appendTrackerEntry({
    kind: 'start',
    pid: child.pid!, // spawn either yields a pid or emits 'error' → exitCode below
    runnerPid: process.pid,
    command,
    port,
    startedAt: Date.now(),
  })

  let stopped = false
  const stop = async (): Promise<void> => {
    if (stopped)
      return
    stopped = true
    if (child.pid) {
      killProcessGroup(child.pid, 'SIGTERM')
      if (!await waitForExit(child, STOP_GRACE_MS))
        killProcessGroup(child.pid, 'SIGKILL')
      appendTrackerEntry({ kind: 'stop', pid: child.pid, runnerPid: process.pid })
    }
    // Give the kernel a moment to release the bound port.
    await sleep(200)
  }

  const readyUrl = `${url}${opts.readyPath}`
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS)
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      await stop()
      throw new Error(`Server exited (code ${child.exitCode}) before becoming healthy: ${readyUrl}\nLast logs:\n${logBuffer.slice(-4000)}`)
    }
    try {
      const res = await fetch(readyUrl, { signal: AbortSignal.timeout(2_000) })
      if (res.ok)
        return { url, port, logs, stop }
    }
    catch {}
    await sleep(POLL_INTERVAL_MS)
  }
  await stop()
  throw new Error(`Timed out waiting for server: ${readyUrl}\nLast logs:\n${logBuffer.slice(-4000)}`)
}

export interface RunningAppServer {
  url: string
  port: number
  server: Server
  stop: () => Promise<void>
}

/**
 * Boot an in-process node HTTP listener (e.g. an h3 app via `toNodeListener`)
 * on the given or a free port. Dies with the test process, so no crash
 * tracking is needed.
 */
export async function startAppServer(listener: RequestListener, opts: { port?: number } = {}): Promise<RunningAppServer> {
  const port = opts.port ?? await getFreePort()
  const server = createServer(listener)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, resolve)
  })
  return {
    url: `http://localhost:${port}`,
    port,
    server,
    stop: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}
