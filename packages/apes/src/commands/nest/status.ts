// `apes nest status` — show what the local nest is supervising.
//
// Talks to the nest-daemon's /status + /agents endpoints. If the daemon
// isn't running (curl-style ECONNREFUSED on localhost), prints a hint
// to run `apes nest install`.

import process from 'node:process'
import { defineCommand } from 'citty'
import consola from 'consola'

const DEFAULT_PORT = 9091

interface NestStatus {
  agents: number
  processes: Array<{ name: string, pid: number, uptimeSec: number, consecutiveCrashes: number }>
}

export const statusNestCommand = defineCommand({
  meta: {
    name: 'status',
    description: 'Print state of the local nest-daemon (agents registered, processes supervised)',
  },
  args: {
    port: { type: 'string', description: 'Override nest port (default: 9091)' },
    json: { type: 'boolean', description: 'JSON output for scripts' },
  },
  async run({ args }) {
    const port = Number(args.port ?? process.env.OPENAPE_NEST_PORT ?? DEFAULT_PORT)
    const url = `http://127.0.0.1:${port}/status`
    let status: NestStatus
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      status = (await res.json()) as NestStatus
    }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
        consola.error(`Nest daemon is not running at http://127.0.0.1:${port}`)
        consola.info('  Run:  apes nest install')
        process.exit(2)
      }
      throw err
    }

    if (args.json) {
      console.log(JSON.stringify(status, null, 2))
      return
    }
    consola.info(`Nest at http://127.0.0.1:${port} — ${status.agents} agent(s) registered, ${status.processes.length} supervised`)
    if (status.processes.length === 0) {
      consola.info('  (no processes running)')
      return
    }
    for (const p of status.processes) {
      const uptime = humanDuration(p.uptimeSec)
      const crashTag = p.consecutiveCrashes > 0 ? ` ⚠ ${p.consecutiveCrashes} crash(es)` : ''
      consola.info(`  ${p.name.padEnd(16)} pid=${String(p.pid).padEnd(6)} up=${uptime}${crashTag}`)
    }
  },
})

function humanDuration(sec: number): string {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return `${Math.floor(sec / 86400)}d`
}
