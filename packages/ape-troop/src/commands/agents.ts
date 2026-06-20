import { defineCommand } from 'citty'
import consola from 'consola'
import { CliError } from '../errors'
import { TroopApi } from '../troop-api'

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 180_000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const listCommand = defineCommand({
  meta: { name: 'list', description: 'List agents owned by the current user on this troop' },
  args: {
    json: { type: 'boolean', description: 'Output as JSON' },
  },
  async run({ args }) {
    const api = new TroopApi()
    const rows = await api.listAgents()
    if (args.json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
      return
    }
    if (rows.length === 0) {
      consola.info('No agents found.')
      return
    }
    const nameW = Math.max(4, ...rows.map(r => r.agentName.length))
    const emailW = Math.max(5, ...rows.map(r => r.email.length))
    const header = `${'NAME'.padEnd(nameW)}  ${'EMAIL'.padEnd(emailW)}  TASKS  LAST-RUN`
    console.log(header)
    console.log('-'.repeat(header.length))
    for (const r of rows) {
      console.log(`${r.agentName.padEnd(nameW)}  ${r.email.padEnd(emailW)}  ${String(r.taskCount).padEnd(5)}  ${r.lastRunStatus ?? '—'}`)
    }
  },
})

const spawnCommand = defineCommand({
  meta: { name: 'spawn', description: 'Spawn a new agent on a bound device (requires DDISA approval on your device)' },
  args: {
    'name': { type: 'positional', required: true, description: 'Agent short name, /^[a-z][a-z0-9-]{0,23}$/' },
    'host-id': { type: 'string', description: 'Target device host_id (default: first connected nest)' },
    'system-prompt': { type: 'string', description: 'Persona / behaviour rules for the agent' },
    'type': { type: 'string', description: 'Runtime type: "bridge" (default) or "openclaw"' },
    'wait': { type: 'boolean', description: 'Poll until the spawn completes or fails' },
    'json': { type: 'boolean', description: 'Output as JSON' },
  },
  async run({ args }) {
    const runtimeType = args.type ? String(args.type) : undefined
    if (runtimeType != null && runtimeType !== 'bridge' && runtimeType !== 'openclaw')
      throw new CliError(`Invalid --type "${runtimeType}". Must be "bridge" or "openclaw".`)
    const api = new TroopApi()
    const intent = await api.spawnAgent({
      name: String(args.name),
      hostId: args['host-id'] ? String(args['host-id']) : undefined,
      systemPrompt: args['system-prompt'] ? String(args['system-prompt']) : undefined,
      runtimeType: runtimeType as 'bridge' | 'openclaw' | undefined,
    })

    if (!args.wait) {
      if (args.json) {
        process.stdout.write(`${JSON.stringify(intent, null, 2)}\n`)
        return
      }
      consola.info(`Spawn requested on ${intent.hostname} (${intent.host_id}). Approve on your device. intent_id=${intent.intent_id}`)
      consola.info('Run with --wait to block until it completes.')
      return
    }

    consola.start(`Waiting for spawn approval on ${intent.hostname}…`)
    const deadline = Date.now() + POLL_TIMEOUT_MS
    while (Date.now() < deadline) {
      const poll = await api.pollSpawn(intent.intent_id)
      if (!poll.pending) {
        if (poll.ok) {
          if (args.json) {
            process.stdout.write(`${JSON.stringify(poll, null, 2)}\n`)
            return
          }
          consola.success(`Spawned ${poll.agent_email}`)
          return
        }
        throw new CliError(`Spawn failed: ${poll.error ?? 'unknown error'}`)
      }
      await sleep(POLL_INTERVAL_MS)
    }
    throw new CliError(`Timed out after ${POLL_TIMEOUT_MS / 1000}s waiting for spawn. intent_id=${intent.intent_id}`)
  },
})

const destroyCommand = defineCommand({
  meta: { name: 'destroy', description: 'Destroy an agent on the device where it lives (requires DDISA approval)' },
  args: {
    'name': { type: 'positional', required: true, description: 'Agent short name' },
    'host-id': { type: 'string', description: 'Target device host_id (default: first connected nest)' },
    'wait': { type: 'boolean', description: 'Poll until the destroy completes or fails' },
    'json': { type: 'boolean', description: 'Output as JSON' },
  },
  async run({ args }) {
    const api = new TroopApi()
    const intent = await api.destroyAgent({
      name: String(args.name),
      hostId: args['host-id'] ? String(args['host-id']) : undefined,
    })

    if (!args.wait) {
      if (args.json) {
        process.stdout.write(`${JSON.stringify(intent, null, 2)}\n`)
        return
      }
      consola.info(`Destroy requested on ${intent.hostname} (${intent.host_id}). Approve on your device. intent_id=${intent.intent_id}`)
      consola.info('Run with --wait to block until it completes.')
      return
    }

    consola.start(`Waiting for destroy approval on ${intent.hostname}…`)
    const deadline = Date.now() + POLL_TIMEOUT_MS
    while (Date.now() < deadline) {
      const poll = await api.pollDestroy(intent.intent_id)
      if (!poll.pending) {
        if (poll.ok) {
          consola.success(`Destroyed ${args.name}`)
          return
        }
        throw new CliError(`Destroy failed: ${poll.error ?? 'unknown error'}`)
      }
      await sleep(POLL_INTERVAL_MS)
    }
    throw new CliError(`Timed out after ${POLL_TIMEOUT_MS / 1000}s waiting for destroy. intent_id=${intent.intent_id}`)
  },
})

const pauseCommand = defineCommand({
  meta: { name: 'pause', description: 'Pause an agent — stays enrolled but runs no LLM turns (zero tokens)' },
  args: {
    'name': { type: 'positional', required: true, description: 'Agent short name' },
    'host-id': { type: 'string', description: 'Target device host_id (default: first connected nest)' },
    'json': { type: 'boolean', description: 'Output as JSON' },
  },
  async run({ args }) {
    const r = await new TroopApi().setAgentPaused({ name: String(args.name), hostId: args['host-id'] ? String(args['host-id']) : undefined, paused: true })
    if (args.json) { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); return }
    consola.success(`Paused ${args.name} on ${r.hostname}`)
  },
})

const resumeCommand = defineCommand({
  meta: { name: 'resume', description: 'Resume a paused agent (instant — no respawn)' },
  args: {
    'name': { type: 'positional', required: true, description: 'Agent short name' },
    'host-id': { type: 'string', description: 'Target device host_id (default: first connected nest)' },
    'json': { type: 'boolean', description: 'Output as JSON' },
  },
  async run({ args }) {
    const r = await new TroopApi().setAgentPaused({ name: String(args.name), hostId: args['host-id'] ? String(args['host-id']) : undefined, paused: false })
    if (args.json) { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); return }
    consola.success(`Resumed ${args.name} on ${r.hostname}`)
  },
})

export const agentsCommand = defineCommand({
  meta: { name: 'agents', description: 'Manage agents on this troop (list, spawn, pause, resume, destroy)' },
  subCommands: {
    list: listCommand,
    spawn: spawnCommand,
    pause: pauseCommand,
    resume: resumeCommand,
    destroy: destroyCommand,
  },
})
