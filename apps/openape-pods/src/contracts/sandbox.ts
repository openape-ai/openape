import { parseCredentialAlias } from './credentials'
import { parseGrantDeclaration, parseGrantTarget } from './grants'
import type { GrantDeclaration, GrantTarget } from './grants'
import { parseHttpPermission } from './http'
import type { HttpPermission } from './http'
import type { DirectoryAccess } from './resources'

/**
 * The sandbox decides what a Pod CAN execute and reach; grants decide what it MAY do. `owner` runs the Pod's
 * programs with the owner's OS reach instead of the isolated profile; that equals full trust in the Pod's code,
 * including the possibility to act as the owner. It never changes the Pod's DDISA identity: requests and grants stay
 * those of the Pod.
 */
export type SandboxLevel = 'isolated' | 'owner'
export const sandboxLevels: readonly SandboxLevel[] = ['isolated', 'owner']

/** Owner files are named by absolute path; their content never passes through MCP. */
export interface SandboxDeclaration {
  level?: SandboxLevel
  programs?: { path: string, adapterPath?: string, commandName?: string, runtimePath?: string }[]
  http?: HttpPermission[]
  directories?: { path: string, access: DirectoryAccess }[]
  secrets?: { alias: string, path: string }[]
  /** Replaces the denylist of this source (the Pod or the network); an empty list clears it. */
  deny?: string[]
}
/** `grants: 'sandbox'` grants exactly what the declaration makes reachable: each program whole and each HTTP origin with its methods. */
export type SandboxCommand
  = | { type: 'show', target: GrantTarget }
    | { type: 'apply', target: GrantTarget, sandbox: SandboxDeclaration, grants?: GrantDeclaration | 'sandbox', approve?: boolean }
/** `deny` is the effective denylist: the Pod's own entries and those of each network it belongs to, by source in `denySources`. */
export interface SandboxView { level: SandboxLevel, sources: { source: string, level: SandboxLevel }[], deny: string[], denySources: { source: string, deny: string[] }[] }
/**
 * How far a Pod's programs reach on this Mac. At `owner` level they reach what the owner reaches, except
 * `protectedPaths`: the Pods folder with every profile and its control socket and the owner's apes login stay closed
 * against direct access; they are required at `owner` level. They are not a boundary: an owner-level program can leave
 * code that later runs unsandboxed as the owner and act as the owner from there, so the owner level equals full trust
 * in the Pod's code, including the possibility to act as the owner (owner decision, issue 1455).
 * `deny` holds the configured denylist as absolute paths, closed for reading and writing at both levels; the folders
 * leading to it cannot be renamed or replaced.
 */
export interface SandboxReach { level: SandboxLevel, protectedPaths: string[], deny?: string[] }

const limit = 16
const denyLimit = 32
function object(value: unknown, keys: string[], message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(message)
  return value as Record<string, unknown>
}
function path(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 4096 || /[\0\r\n]/.test(value)) throw new Error('Absolute local file path required')
  return value
}
function list(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`Declare at most ${limit} sandbox ${name}`)
  return value
}

export function parseSandboxLevel(value: unknown): SandboxLevel {
  if (!sandboxLevels.includes(value as SandboxLevel)) throw new Error('Sandbox level is isolated or owner')
  return value as SandboxLevel
}

/** One denylist entry: an absolute path or one below the owner's home (`~/…`), without wildcards, `.` or `..` parts. */
export function parseSandboxDenyPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1024 || !/^~?\/[^/]/.test(value) || /[\0\r\n\\"*?[\]{}]/.test(value) || value.split('/').some(part => part === '.' || part === '..')) throw new Error('A denied path is absolute or starts with ~/, without wildcards')
  return value.replace(/\/{2,}/g, '/').replace(/\/$/, '')
}

/** A denylist without duplicates; at most 32 entries. */
export function parseSandboxDeny(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > denyLimit) throw new Error('Declare at most 32 denied paths')
  return [...new Set(value.map(parseSandboxDenyPath))]
}

export function parseSandboxView(value: unknown): SandboxView {
  const view = object(value, ['level', 'sources', 'deny', 'denySources'], 'Invalid sandbox view')
  parseSandboxLevel(view.level); parseSandboxDeny(view.deny)
  if (!Array.isArray(view.sources) || !Array.isArray(view.denySources)) throw new Error('Invalid sandbox view')
  for (const item of view.sources) parseSandboxLevel(object(item, ['source', 'level'], 'Invalid sandbox view').level)
  for (const item of view.denySources) parseSandboxDeny(object(item, ['source', 'deny'], 'Invalid sandbox view').deny)
  return value as SandboxView
}

export function parseSandboxDeclaration(value: unknown): SandboxDeclaration {
  const input = object(value, ['level', 'programs', 'http', 'directories', 'secrets', 'deny'], 'Invalid sandbox declaration')
  const result: SandboxDeclaration = {}
  if (input.level !== undefined) result.level = parseSandboxLevel(input.level)
  if (input.programs !== undefined) {
    result.programs = list(input.programs, 'programs').map((entry) => {
      const item = object(entry, ['path', 'adapterPath', 'commandName', 'runtimePath'], 'Invalid sandbox program')
      if (item.commandName !== undefined && (typeof item.commandName !== 'string' || !/^[\w.-]{1,100}$/.test(item.commandName))) throw new Error('Invalid command name')
      return { path: path(item.path), ...(item.adapterPath === undefined ? {} : { adapterPath: path(item.adapterPath) }), ...(item.commandName === undefined ? {} : { commandName: item.commandName as string }), ...(item.runtimePath === undefined ? {} : { runtimePath: path(item.runtimePath) }) }
    })
  }
  if (input.http !== undefined) result.http = list(input.http, 'HTTP origins').map(parseHttpPermission)
  if (input.directories !== undefined) {
    result.directories = list(input.directories, 'directories').map((entry) => {
      const item = object(entry, ['path', 'access'], 'Invalid sandbox directory')
      if (item.access !== 'read' && item.access !== 'readWrite') throw new Error('Directory access is read or readWrite')
      return { path: path(item.path), access: item.access }
    })
  }
  if (input.secrets !== undefined) {
    result.secrets = list(input.secrets, 'secrets').map((entry) => {
      const item = object(entry, ['alias', 'path'], 'Invalid sandbox secret')
      return { alias: parseCredentialAlias(item.alias), path: path(item.path) }
    })
  }
  if (input.deny !== undefined) result.deny = parseSandboxDeny(input.deny)
  return result
}

export function parseSandboxCommand(value: unknown): SandboxCommand {
  const command = object(value, ['type', 'target', 'sandbox', 'grants', 'approve'], 'Invalid sandbox command')
  if (command.type === 'show') {
    object(command, ['type', 'target'], 'Invalid sandbox command fields')
    return { type: 'show', target: parseGrantTarget(command.target) }
  }
  if (command.type !== 'apply') throw new Error('Unsupported sandbox command')
  if (command.approve !== undefined && typeof command.approve !== 'boolean') throw new Error('approve must be a boolean')
  const grants = command.grants === undefined ? undefined : command.grants === 'sandbox' ? 'sandbox' as const : parseGrantDeclaration(command.grants)
  return { type: 'apply', target: parseGrantTarget(command.target), sandbox: parseSandboxDeclaration(command.sandbox), ...(grants === undefined ? {} : { grants }), ...(command.approve === undefined ? {} : { approve: command.approve }) }
}

/** The more permissive level wins: a network member inherits the network sandbox plus its own. */
export function effectiveSandboxLevel(levels: SandboxLevel[]): SandboxLevel {
  return levels.includes('owner') ? 'owner' : 'isolated'
}
