// Nest registry — the source of truth for "which agents live on this
// computer". Persisted to ~/.openape/nest/agents.json so the supervisor
// re-spawns the right children after a daemon restart.
//
// Each entry holds the bare minimum needed to (a) re-spawn the agent's
// chat-bridge child and (b) destroy the agent later. Tasks, system
// prompt, etc. live in the agent's own $HOME and aren't duplicated here.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface AgentEntry {
  /** macOS short username — also the agent's display name. */
  name: string
  /** Numeric uid — read from dscl at registration time. */
  uid: number
  /** Absolute home directory. */
  home: string
  /** DDISA email at IdP. */
  email: string
  /** When the agent was first added to this nest. */
  registeredAt: number
  /**
   * Bridge config the supervisor passes via env when spawning the
   * child. Mirrors what `apes agents spawn --bridge*` would have written
   * into the bridge's .env, but kept on the nest side so we can update
   * it (model swap, key rotation) without re-running spawn.
   */
  bridge?: {
    baseUrl?: string
    apiKey?: string
    model?: string
    /** Reasoning/thinking depth (gpt-5.x) — PM tiers compute by difficulty. */
    reasoningEffort?: string
  }
  /**
   * Agent kind. 'user' (default, also when absent → backward-compatible)
   * connects to troop-chat; 'service' polls an SP backend's task queue and
   * runs each task through the LLM. The supervisor starts a different binary
   * per kind (`ape-agent` vs `ape-agent-service`).
   */
  kind?: 'user' | 'service'
  /**
   * Which runtime executes this agent. Absent/'bridge' (default) → our own
   * @openape/ape-agent bridge, supervised as a long-lived pm2 daemon. 'openclaw'
   * → a foreign one-shot runtime the nest exec's per message (no pm2 daemon);
   * the supervisor skips it and the chat router invokes it instead.
   * Orthogonal to `kind` (a 'bridge' runtime can be 'user' or 'service').
   */
  runtimeType?: 'bridge' | 'openclaw'
  /** Required for kind='service': the SP backend this agent serves. */
  service?: {
    /** Base URL of the SP (where GetNextTask/ResolveTask live). */
    spBaseUrl: string
    /** Idle poll interval in ms (default 2000). */
    pollIntervalMs?: number
  }
}

interface RegistryFile {
  version: 1
  agents: AgentEntry[]
}

// Registry path resolution — kept in lockstep with
// `packages/apes/src/lib/nest-registry.ts:resolveRegistryPath()`
// so the writer (apes-cli during `apes agents spawn`) and the
// reader (this daemon) target the same file. Phase G migrated the
// canonical location to `/var/openape/nest/agents.json` (group-readable
// by `_openape_nest`); pre-migration installs still keep the file
// under the nest's HOME=~/.openape/nest/.
//
// `OPENAPE_NEST_REGISTRY_PATH` overrides everything — mandatory so
// `pnpm test` on a dev machine that has a real nest installed (the
// post-Phase-G `/var/openape/nest/` exists) doesn't have the
// vitest "corrupt-json" case clobber production data. Production
// setups don't set the override; this is purely a test-time guard.
function resolveRegistryPath(): string {
  if (process.env.OPENAPE_NEST_REGISTRY_PATH) return process.env.OPENAPE_NEST_REGISTRY_PATH
  if (existsSync('/var/openape/nest/agents.json')) return '/var/openape/nest/agents.json'
  if (existsSync('/var/openape/nest')) return '/var/openape/nest/agents.json'
  return join(homedir(), 'agents.json')
}
export const REGISTRY_PATH = resolveRegistryPath()
const REGISTRY_DIR = REGISTRY_PATH.replace(/\/agents\.json$/, '')

function emptyRegistry(): RegistryFile {
  return { version: 1, agents: [] }
}

export function readRegistry(): RegistryFile {
  if (!existsSync(REGISTRY_PATH)) return emptyRegistry()
  try {
    const parsed = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as RegistryFile
    if (parsed?.version !== 1 || !Array.isArray(parsed.agents)) return emptyRegistry()
    return parsed
  }
  catch {
    return emptyRegistry()
  }
}

export function writeRegistry(reg: RegistryFile): void {
  mkdirSync(REGISTRY_DIR, { recursive: true })
  // mode 660 (not 600): the apes-cli running as the human user reads
  // the registry directly to power `apes nest list` and the spawn
  // path's `upsertNestAgent` write — Patrick is in the
  // `_openape_nest` group post-`migrate-to-service-user`, so 660 lets
  // him rw without sudo. The file holds no secrets (just agent
  // metadata: uid, home, email).
  writeFileSync(REGISTRY_PATH, `${JSON.stringify(reg, null, 2)}\n`, { mode: 0o660 })
}

export function listAgents(): AgentEntry[] {
  return readRegistry().agents
}

export function findAgent(name: string): AgentEntry | undefined {
  return readRegistry().agents.find(a => a.name === name)
}

export function upsertAgent(entry: AgentEntry): void {
  const reg = readRegistry()
  const existing = reg.agents.findIndex(a => a.name === entry.name)
  if (existing >= 0) reg.agents[existing] = entry
  else reg.agents.push(entry)
  writeRegistry(reg)
}

export function removeAgent(name: string): boolean {
  const reg = readRegistry()
  const before = reg.agents.length
  reg.agents = reg.agents.filter(a => a.name !== name)
  if (reg.agents.length === before) return false
  writeRegistry(reg)
  return true
}

export const _internal = { REGISTRY_PATH }
