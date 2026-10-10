import { parseCredentialAlias } from './credentials'
import { parseGrantDeclaration, parseGrantTarget } from './grants'
import type { GrantDeclaration, GrantTarget } from './grants'
import { parseHttpPermission } from './http'
import type { HttpPermission } from './http'
import type { DirectoryAccess } from './resources'

/**
 * The sandbox decides what a Pod CAN execute and reach; grants decide what it MAY do. `owner` runs the Pod's
 * programs with the owner's file and network reach instead of the isolated profile. It never changes the Pod's
 * DDISA identity: requests and grants stay those of the Pod.
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
}
/** `grants: 'sandbox'` grants exactly what the declaration makes reachable: each program whole and each HTTP origin with its methods. */
export type SandboxCommand
  = | { type: 'show', target: GrantTarget }
    | { type: 'apply', target: GrantTarget, sandbox: SandboxDeclaration, grants?: GrantDeclaration | 'sandbox', approve?: boolean }
export interface SandboxView { level: SandboxLevel, sources: { source: string, level: SandboxLevel }[] }
/**
 * How far a Pod's programs reach on this Mac. At `owner` level they reach what the owner reaches, except
 * `protectedPaths`: the Pods profile, the owner's apes login and the keychain files stay closed, so a Pod program can
 * never take the owner identity or change Pods state. `persistencePaths` are readable but never writable, so nothing
 * a run leaves behind starts again after it. Both are required at `owner` level.
 */
export interface SandboxReach { level: SandboxLevel, protectedPaths: string[], persistencePaths?: string[] }

const limit = 16
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

export function parseSandboxDeclaration(value: unknown): SandboxDeclaration {
  const input = object(value, ['level', 'programs', 'http', 'directories', 'secrets'], 'Invalid sandbox declaration')
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
