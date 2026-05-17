// Shared "Nest registry" helper — Phase F (#sim-arch) lets the
// apes-cli read+write the Nest's `agents.json` directly instead of
// going through an intent-channel handler in the Nest. The Nest
// watches the file and reconciles its pm2-supervisor automatically.
//
// The registry is the source of truth for "which agents live on
// this computer" — the Nest reads it at boot and after every fs
// change, the apes-cli writes to it after every `apes agents
// spawn|destroy`.
//
// Path: `/var/openape/nest/agents.json` (mode 660, owner
// `_openape_nest:_openape_nest`). Patrick is in the
// `_openape_nest` group post-`apes nest migrate-to-service-user`,
// so he can rw the file directly. Pre-migration installs use
// `~/.openape/nest/agents.json` under the human's home and don't
// need the group dance — the file is plain Patrick-owned.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface AgentEntry {
  name: string
  uid: number
  home: string
  email: string
  registeredAt: number
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

/** Resolve the registry path. Prefers the post-migration system
 *  location; falls back to the per-user location otherwise. */
export function resolveRegistryPath(): string {
  if (existsSync('/var/openape/nest/agents.json')) return '/var/openape/nest/agents.json'
  if (existsSync('/var/openape/nest')) return '/var/openape/nest/agents.json'
  return join(homedir(), '.openape', 'nest', 'agents.json')
}

function emptyRegistry(): RegistryFile {
  return { version: 1, agents: [] }
}

export function readNestRegistry(): RegistryFile {
  const path = resolveRegistryPath()
  if (!existsSync(path)) return emptyRegistry()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as RegistryFile
    if (parsed?.version !== 1 || !Array.isArray(parsed.agents)) return emptyRegistry()
    return parsed
  }
  catch {
    return emptyRegistry()
  }
}

export function writeNestRegistry(reg: RegistryFile): void {
  const path = resolveRegistryPath()
  const dir = path.replace(/\/agents\.json$/, '')
  try { mkdirSync(dir, { recursive: true }) }
  catch { /* may exist with stricter perms */ }
  writeFileSync(path, `${JSON.stringify(reg, null, 2)}\n`, { mode: 0o660 })
}

export function upsertNestAgent(entry: AgentEntry): void {
  const reg = readNestRegistry()
  const existing = reg.agents.findIndex(a => a.name === entry.name)
  if (existing >= 0) reg.agents[existing] = entry
  else reg.agents.push(entry)
  writeNestRegistry(reg)
}

export function removeNestAgent(name: string): boolean {
  const reg = readNestRegistry()
  const before = reg.agents.length
  reg.agents = reg.agents.filter(a => a.name !== name)
  if (reg.agents.length === before) return false
  writeNestRegistry(reg)
  return true
}
