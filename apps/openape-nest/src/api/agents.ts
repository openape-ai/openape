// HTTP API handlers for /agents and /status. Each handler is small and
// independent — the daemon's index.ts just routes to them. Spawn /
// destroy delegate the privileged ops to `apes agents spawn|destroy`
// via execFile (going through the existing always-grant flow); the
// nest never directly creates macOS users itself.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { listAgents, removeAgent, upsertAgent, findAgent  } from '../lib/registry'
import type { AgentEntry } from '../lib/registry'

const execFileAsync = promisify(execFile)

const NAME_REGEX = /^[a-z][a-z0-9-]{0,23}$/

interface RouteCtx {
  url: URL
  body: unknown
  log: (line: string) => void
  apesBin: string
  /** DDISA-grant subject — set by the auth middleware. 'unauth' on
   * the legacy (M2-pending) write endpoints. */
  caller: string
  grantId: string
  supervisor: import('../lib/pm2-supervisor').Pm2Supervisor
}

export function handleNestStatus(_ctx: RouteCtx): { agents: number } {
  return {
    agents: listAgents().length,
  }
}

export function handleAgentsList(_ctx: RouteCtx): { agents: AgentEntry[] } {
  return { agents: listAgents() }
}

export async function handleAgentSpawn(ctx: RouteCtx): Promise<{ name: string, email: string, uid: number, home: string }> {
  const body = ctx.body as Record<string, unknown> | undefined
  const name = typeof body?.name === 'string' ? body.name : ''
  if (!NAME_REGEX.test(name)) {
    throw new Error(`name must match ${NAME_REGEX} (got "${name}")`)
  }
  if (findAgent(name)) {
    throw new Error(`agent "${name}" is already registered with this nest`)
  }

  // Delegate privileged setup to the existing apes spawn flow. The nest
  // daemon runs with HOME=~/.openape/nest so apes-cli reads the nest's
  // own auth.json — YOLO-policy on the nest-identity auto-approves the
  // outer grant + the inner setup.sh-grant. `--wait` blocks until the
  // grant is approved AND the command finishes (without it, apes run
  // returns exit 75 EX_TEMPFAIL the moment the grant is created, even
  // when YOLO auto-approves milliseconds later).
  const args = ['run', '--as', 'root', '--wait', '--', 'apes', 'agents', 'spawn', name]
  // Bridge is on by default — without it the agent has no chat
  // connection + no cron-runner, which makes it functionally inert.
  // Pass `bridge: false` explicitly to opt out.
  const includeBridge = body?.bridge !== false
  if (includeBridge) {
    args.push('--bridge')
    if (typeof body?.bridgeKey === 'string') args.push('--bridge-key', body.bridgeKey)
    if (typeof body?.bridgeBaseUrl === 'string') args.push('--bridge-base-url', body.bridgeBaseUrl)
    if (typeof body?.bridgeModel === 'string') args.push('--bridge-model', body.bridgeModel)
  }
  ctx.log(`nest: spawning agent "${name}" via apes...`)
  const { stdout: _stdout } = await execFileAsync(ctx.apesBin, args, { maxBuffer: 4 * 1024 * 1024 })

  // After spawn, look up uid + home for registry. Fall back to
  // /Users/<name> + dscl-resolved uid.
  const uid = await readUidFromDscl(name)
  const entry: AgentEntry = {
    name,
    uid,
    home: `/Users/${name}`,
    email: '', // filled in on first sync — we don't know it locally
    registeredAt: Math.floor(Date.now() / 1000),
    bridge: includeBridge
      ? {
          baseUrl: typeof body?.bridgeBaseUrl === 'string' ? body.bridgeBaseUrl : undefined,
          apiKey: typeof body?.bridgeKey === 'string' ? body.bridgeKey : undefined,
          model: typeof body?.bridgeModel === 'string' ? body.bridgeModel : undefined,
        }
      : undefined,
  }
  upsertAgent(entry)
  // Hand the new agent to the supervisor so its bridge starts.
  await ctx.supervisor.reconcile(listAgents())
  return { name, email: entry.email, uid, home: entry.home }
}

export async function handleAgentDestroy(ctx: RouteCtx, name: string): Promise<{ name: string, removed: boolean }> {
  if (!NAME_REGEX.test(name)) throw new Error(`invalid agent name "${name}"`)
  const entry = findAgent(name)
  if (!entry) throw new Error(`agent "${name}" not registered with this nest`)

  // Delegate privileged teardown.
  ctx.log(`nest: destroying agent "${name}"...`)
  const args = ['run', '--as', 'root', '--', 'apes', 'agents', 'destroy', name, '--force']
  await execFileAsync(ctx.apesBin, args, { maxBuffer: 4 * 1024 * 1024 })

  removeAgent(name)
  // pm2-supervisor reconciles to the new registry — picks up the
  // missing agent and pm2-deletes the bridge process.
  await ctx.supervisor.reconcile(listAgents())
  return { name, removed: true }
}

async function readUidFromDscl(name: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/dscl', ['.', '-read', `/Users/${name}`, 'UniqueID'])
    const match = stdout.match(/UniqueID:\s*(\d+)/)
    if (match) return Number(match[1])
  }
  catch { /* fall through */ }
  return -1
}
