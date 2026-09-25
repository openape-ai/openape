import { parseDetailsCommand } from './details'
import { parseMasterCommand } from './master'
import { parseResourceCommand } from './resources'
import { parseScriptCommand } from './scripts'
import { parseRunCommand } from './runs'
import { parseProgramCommand } from './programs'
import { parseCredentialAlias } from './credentials'
import type { CodexRequest } from './codex'

export const administrationActions = ['resources', 'scripts', 'recovery', 'program', 'importSecret', 'description', 'setup']

export function parseAdministration(action: Record<string, unknown>) {
  const { action: kind, command, revision, path, adapterPath, commandName, runtimePath } = action
  if (!administrationActions.includes(String(kind)) || Object.keys(action).some(key => !['action', 'command', 'revision', 'path', 'adapterPath', 'commandName', 'runtimePath'].includes(key))) throw new Error('Invalid administration action')
  if (!Number.isSafeInteger(revision) || Number(revision) < 1) throw new Error('Current Pod revision required')
  if (kind === 'description') {
    const parsed = parseDetailsCommand(command)
    if (parsed.type !== 'describe' && parsed.type !== 'list') throw new Error('Unsupported description operation')
    noPaths(action)
    return { kind, revision: Number(revision), command: parsed } as const
  }
  if (kind === 'setup') {
    const parsed = parseMasterCommand(command)
    if ((parsed.type !== 'decline' && parsed.type !== 'resolveSetup') || !parsed.podId || ['creationId', 'conversationId', 'contextRevision', 'before'].some(key => key in parsed)) throw new Error('Unsupported legacy setup operation')
    noPaths(action)
    return { kind, revision: Number(revision), command: { ...parsed, podId: parsed.podId } } as const
  }
  if (kind === 'importSecret') {
    const value = command as { podId: string, alias: string, epoch: number }
    if (!value || Object.keys(value).some(key => !['podId', 'alias', 'epoch'].includes(key)) || !/^[a-f0-9-]{36}$/.test(value.podId) || !Number.isSafeInteger(value.epoch) || value.epoch < 0) throw new Error('Invalid credential import')
    parseCredentialAlias(value.alias)
    if (adapterPath !== undefined || commandName !== undefined || runtimePath !== undefined) throw new Error('Invalid credential import fields')
    return { kind, revision: Number(revision), command: value, path: absolutePath(path) } as const
  }
  if (kind === 'resources') {
    const parsed = parseResourceCommand(command, true)
    if (!['list', 'assignJev', 'assignHttp', 'assignDirectory', 'assignReference', 'revoke', 'removeVariable'].includes(parsed.type)) throw new Error('Unsupported Codex resource operation; import secrets by private file')
    noPaths(action)
    return { kind, revision: Number(revision), command: parsed } as const
  }
  if (kind === 'scripts') {
    const parsed = parseScriptCommand(command)
    if (!['list', 'prepareDependencies', 'approveCredentials'].includes(parsed.type)) throw new Error('Use draft, validate and activate actions for scripts')
    noPaths(action)
    return { kind, revision: Number(revision), command: parsed } as const
  }
  if (kind === 'recovery') {
    const parsed = parseRunCommand(command)
    if (!['list', 'recover', 'resolveHttp', 'retryQueue', 'cancel'].includes(parsed.type)) throw new Error('Unsupported Codex recovery operation')
    noPaths(action)
    return { kind, revision: Number(revision), command: parsed } as const
  }
  const parsed = parseProgramCommand(command)
  if (!['add', 'replace', 'network', 'grant', 'importState', 'prepare'].includes(parsed.type)) throw new Error('Use Pod scripts to execute assigned programs')
  if (['add', 'replace', 'importState'].includes(parsed.type)) {
    absolutePath(path)
    if (adapterPath !== undefined) absolutePath(adapterPath)
    if (runtimePath !== undefined) absolutePath(runtimePath)
    if (commandName !== undefined && (typeof commandName !== 'string' || !/^[\w.-]{1,100}$/.test(commandName))) throw new Error('Invalid command name')
    if (parsed.type === 'importState' && (adapterPath !== undefined || commandName !== undefined || runtimePath !== undefined)) throw new Error('Invalid state import fields')
  }
  else {
    noPaths(action)
  }
  return { kind: 'program', revision: Number(revision), command: parsed, path: path as string | undefined, adapterPath: adapterPath as string | undefined, commandName: commandName as string | undefined, runtimePath: runtimePath as string | undefined } as const
}

function absolutePath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 4096 || /[\0\r\n]/.test(value)) throw new Error('Absolute local file path required')
  return value
}
function noPaths(action: Record<string, unknown>) {
  if (['path', 'adapterPath', 'commandName', 'runtimePath'].some(key => key in action)) throw new Error('Unexpected administration path')
}

export type AdministrationReceipt = { completed: false } | { completed: true, result: unknown }
export type AdministrationJournal = { type: 'begin', request: CodexRequest } | { type: 'complete', request: CodexRequest, result: unknown } | { type: 'failed', request: CodexRequest }
