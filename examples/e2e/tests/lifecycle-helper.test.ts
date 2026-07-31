import type { TrackerEntry } from '../helpers/lifecycle.js'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { cleanupStaleEntries, getFreePort, readTrackerEntries, startAppServer, startServer } from '../helpers/lifecycle.js'

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch {
    return false
  }
}

/** A pid that is guaranteed dead: a process that already ran to completion. */
function deadPid(): number {
  const res = spawnSync('true')
  return res.pid
}

function writeTracker(entries: TrackerEntry[]): string {
  const file = join(mkdtempSync(join(tmpdir(), 'lifecycle-test-')), 'servers.jsonl')
  writeFileSync(file, entries.map(e => `${JSON.stringify(e)}\n`).join(''))
  return file
}

describe('getFreePort', () => {
  it('returns a port that can actually be bound', async () => {
    const port = await getFreePort()
    expect(port).toBeGreaterThan(0)
    await new Promise<void>((resolve, reject) => {
      const srv = createServer()
      srv.once('error', reject)
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve()))
    })
  })
})

describe('startAppServer', () => {
  it('serves an in-process listener on a free port and stops again', async () => {
    const app = await startAppServer((_req, res) => res.end('ok'))
    const body = await (await fetch(app.url)).text()
    expect(body).toBe('ok')
    await app.stop()
    await expect(fetch(app.url, { signal: AbortSignal.timeout(1000) })).rejects.toThrow()
  })
})

describe('startServer', () => {
  it('spawns a process, waits for readiness, and kills the process group on stop', async () => {
    const script = 'const http = require("node:http"); http.createServer((q, s) => s.end("up")).listen(Number(process.env.PORT), "127.0.0.1")'
    const server = await startServer({
      cwd: process.cwd(),
      command: () => ['node', '-e', script],
      env: ({ port }) => ({ PORT: String(port) }),
      readyPath: '/',
      timeoutMs: 15_000,
    })
    expect((await fetch(server.url)).ok).toBe(true)
    await server.stop()
    await expect(fetch(server.url, { signal: AbortSignal.timeout(1000) })).rejects.toThrow()
  })

  it('fails fast with the log tail when the process exits before readiness', async () => {
    await expect(startServer({
      cwd: process.cwd(),
      command: () => ['node', '-e', 'console.error("boom-marker"); process.exit(3)'],
      readyPath: '/',
      timeoutMs: 15_000,
    })).rejects.toThrow(/boom-marker/)
  })
})

describe('cleanupStaleEntries', () => {
  it('removes temp dirs of dead runners and keeps those of live runners', () => {
    const staleDir = mkdtempSync(join(tmpdir(), 'lifecycle-stale-'))
    const liveDir = mkdtempSync(join(tmpdir(), 'lifecycle-live-'))
    const file = writeTracker([
      { kind: 'tempdir', dir: staleDir, runnerPid: deadPid() },
      { kind: 'tempdir', dir: liveDir, runnerPid: process.pid },
    ])

    cleanupStaleEntries(file)

    expect(existsSync(staleDir)).toBe(false)
    expect(existsSync(liveDir)).toBe(true)
    expect(readTrackerEntries(file)).toEqual([
      { kind: 'tempdir', dir: liveDir, runnerPid: process.pid },
    ])
  })

  it('kills an orphaned server whose command line still matches', async () => {
    const orphan = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
    const file = writeTracker([
      { kind: 'start', pid: orphan.pid!, runnerPid: deadPid(), command: ['sleep', '30'], port: 0, startedAt: Date.now() },
    ])

    cleanupStaleEntries(file)

    const deadline = Date.now() + 3_000
    while (isPidAlive(orphan.pid!) && Date.now() < deadline)
      await sleep(50)
    expect(isPidAlive(orphan.pid!)).toBe(false)
  })

  it('never kills a pid whose command line does not match the recorded one', async () => {
    const bystander = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
    const file = writeTracker([
      // Same pid, but recorded as a nuxt dev server — pid was reused by
      // another process, so cleanup must leave it alone.
      { kind: 'start', pid: bystander.pid!, runnerPid: deadPid(), command: ['pnpm', 'exec', 'nuxt', 'dev', '--port', '65000'], port: 65000, startedAt: Date.now() },
    ])

    cleanupStaleEntries(file)
    await sleep(200)

    expect(isPidAlive(bystander.pid!)).toBe(true)
    try {
      process.kill(-bystander.pid!, 'SIGKILL')
    }
    catch {}
  })

  it('does not touch servers that were stopped cleanly', async () => {
    const bystander = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
    const runner = deadPid()
    const file = writeTracker([
      { kind: 'start', pid: bystander.pid!, runnerPid: runner, command: ['sleep', '30'], port: 0, startedAt: Date.now() },
      { kind: 'stop', pid: bystander.pid!, runnerPid: runner },
    ])

    cleanupStaleEntries(file)
    await sleep(200)

    expect(isPidAlive(bystander.pid!)).toBe(true)
    try {
      process.kill(-bystander.pid!, 'SIGKILL')
    }
    catch {}
    expect(readTrackerEntries(file)).toEqual([])
  })
})
