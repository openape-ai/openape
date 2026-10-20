import { parseCommand } from './control'
import type { WorkspaceCommand } from './control'
import { parseRunCommand } from './runs'
import type { RunCommand } from './runs'
import { parseScriptCommand } from './scripts'
import type { ScriptCommand } from './scripts'
import { parseOnboardingCommand } from './onboarding'
import type { ProxyCommand } from './onboarding'

export type CliRequest =
  | { channel: 'workspace', command: WorkspaceCommand }
  | { channel: 'runs', command: Extract<RunCommand, { type: 'list' | 'start' | 'cancel' }> }
  | { channel: 'scripts', command: Exclude<ScriptCommand, { type: 'approveCredentials' }> }
  | { channel: 'agentBackends', command: ProxyCommand }

export function parseCliRequest(value: unknown): CliRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid CLI command')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !['channel', 'command'].includes(key))) throw new Error('Unsupported CLI fields')
  if (input.channel === 'agentBackends') {
    const command = parseOnboardingCommand(input.command)
    if (command.type !== 'proxyStatus' && command.type !== 'reloadProxy' && command.type !== 'disableProxy') throw new Error('Unsupported CLI agent backend command')
    return { channel: input.channel, command }
  }
  if (input.channel === 'workspace') {
    const command = parseCommand(input.command)
    if (command.type === 'pauseAll' || command.type === 'map') throw new Error('Unsupported CLI workspace command')
    return { channel: input.channel, command }
  }
  if (input.channel === 'runs') {
    const command = parseRunCommand(input.command)
    if (command.type !== 'list' && command.type !== 'start' && command.type !== 'cancel') throw new Error('Unsupported CLI run command')
    return { channel: input.channel, command }
  }
  if (input.channel === 'scripts') {
    const command = parseScriptCommand(input.command)
    if (command.type === 'approveCredentials') throw new Error('CLI secret administration is not supported')
    return { channel: input.channel, command }
  }
  throw new Error('Unsupported CLI channel')
}
