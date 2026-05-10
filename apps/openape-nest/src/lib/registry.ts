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
  }
}

interface RegistryFile {
  version: 1
  agents: AgentEntry[]
}

// The nest daemon's launchd plist sets HOME=~/.openape/nest, so
// homedir() already points at the nest's data dir. Joining
// `.openape/nest/agents.json` on top of that produces a doubly-nested
// path (`~/.openape/nest/.openape/nest/agents.json`) that the YOLO
// log search and humans never find. Keep the registry directly under
// the data dir.
const REGISTRY_DIR = homedir()
export const REGISTRY_PATH = join(REGISTRY_DIR, 'agents.json')

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
  writeFileSync(REGISTRY_PATH, `${JSON.stringify(reg, null, 2)}\n`, { mode: 0o600 })
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
