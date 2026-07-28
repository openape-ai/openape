import { defineCommand } from 'citty'
import consola from 'consola'
import { TroopApi } from '../troop-api'

function fmtTime(secOrMs: number | null): string {
  if (!secOrMs) return 'never'
  // troop stores epoch-ms; tolerate seconds just in case.
  const ms = secOrMs < 1e12 ? secOrMs * 1000 : secOrMs
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16)
}

const bindCommand = defineCommand({
  meta: { name: 'bind', description: 'Bind a device (pod) to your account and mint its host_id' },
  args: {
    'display-name': { type: 'positional', required: true, description: 'Human-readable name for the device, e.g. "mbp-home"' },
    'pod-uuid': { type: 'string', description: 'Optional pod/container UUID — re-binding with the same uuid is idempotent' },
    'json': { type: 'boolean', description: 'Output as JSON' },
  },
  async run({ args }) {
    const api = new TroopApi()
    const res = await api.bindNest(String(args['display-name']), args['pod-uuid'] ? String(args['pod-uuid']) : undefined)
    if (args.json) {
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`)
      return
    }
    if (res.reused) {
      consola.info(`Device already bound — reusing host_id ${res.host_id}`)
    }
    else {
      consola.success(`Bound "${res.display_name}" → host_id ${res.host_id}`)
    }
  },
})

const listCommand = defineCommand({
  meta: { name: 'list', description: 'List devices bound to your account' },
  args: {
    all: { type: 'boolean', description: 'Include revoked devices (default shows active only)' },
    json: { type: 'boolean', description: 'Output as JSON' },
  },
  async run({ args }) {
    const api = new TroopApi()
    const all = await api.listNests()
    const rows = args.all ? all : all.filter(n => n.status === 'active')

    if (args.json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
      return
    }
    if (rows.length === 0) {
      consola.info(args.all ? 'No devices bound.' : 'No active devices. Use --all to show revoked.')
      return
    }
    const hostW = Math.max(7, ...rows.map(r => r.host_id.length))
    const nameW = Math.max(4, ...rows.map(r => r.display_name.length))
    const header = `${'HOST_ID'.padEnd(hostW)}  ${'NAME'.padEnd(nameW)}  STATUS   LAST-SEEN`
    console.log(header)
    console.log('-'.repeat(header.length))
    for (const r of rows) {
      console.log(`${r.host_id.padEnd(hostW)}  ${r.display_name.padEnd(nameW)}  ${r.status.padEnd(7)}  ${fmtTime(r.last_seen_at)}`)
    }
  },
})

const removeCommand = defineCommand({
  meta: { name: 'remove', description: 'Revoke a device binding (soft — keeps history, instantly cuts the device off)' },
  args: {
    host_id: { type: 'positional', required: true, description: 'host_id of the device to revoke' },
    json: { type: 'boolean', description: 'Output as JSON' },
  },
  async run({ args }) {
    const api = new TroopApi()
    const res = await api.removeNest(String(args.host_id))
    if (args.json) {
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`)
      return
    }
    consola.success(`Revoked device ${res.host_id}`)
  },
})

const pauseCommand = defineCommand({
  meta: { name: 'pause', description: 'Pause every agent on a device (fleet kill-switch) — they stay connected, run no LLM turns' },
  args: {
    host_id: { type: 'positional', required: true, description: 'host_id of the device to pause' },
    json: { type: 'boolean', description: 'Output as JSON' },
  },
  async run({ args }) {
    const r = await new TroopApi().setNestPaused(String(args.host_id), true)
    if (args.json) { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); return }
    consola.success(`Paused all agents on ${r.hostname}`)
  },
})

const resumeCommand = defineCommand({
  meta: { name: 'resume', description: 'Resume a paused device (clears the fleet switch; per-agent pauses still stand)' },
  args: {
    host_id: { type: 'positional', required: true, description: 'host_id of the device to resume' },
    json: { type: 'boolean', description: 'Output as JSON' },
  },
  async run({ args }) {
    const r = await new TroopApi().setNestPaused(String(args.host_id), false)
    if (args.json) { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); return }
    consola.success(`Resumed ${r.hostname}`)
  },
})

export const nestsCommand = defineCommand({
  meta: { name: 'nests', description: 'Manage devices (pods) bound to your account' },
  subCommands: {
    bind: bindCommand,
    list: listCommand,
    pause: pauseCommand,
    resume: resumeCommand,
    remove: removeCommand,
  },
})
