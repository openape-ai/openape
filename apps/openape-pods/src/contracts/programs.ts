import type { ProgramAuthority } from '../main/programs/grants'

export interface ProgramDefinition {
  name: string
  executable: string
  executableHash: string
  cliId: string
  adapterPath: string
  adapterHash: string
  networkHosts: string[]
  cacheArgument?: '--cache-dir'
  entryFiles: { path: string, hash: string }[]
  environment: Record<string, string>
}
export interface ProgramAssignment extends ProgramDefinition {
  type: 'program'
  stateId: string
  capability: string
  grants: { permission: string, display: string, authority: ProgramAuthority }[]
}
export type ProgramCommand =
  | { type: 'openShell', podId: string }
  | { type: 'prepare', podId: string, line: string }
  | { type: 'add', podId: string, epoch: number, source: 'o365-cli' | 'choose' }
  | { type: 'grant', podId: string, applicationId: string, epoch: number, argv: string[] }
  | { type: 'start', podId: string, applicationId: string, epoch: number, argv: string[] }
  | { type: 'importState', podId: string, applicationId: string, epoch: number }
  | { type: 'poll', podId: string, sessionId: string, after: number }
  | { type: 'input', podId: string, sessionId: string, data: string }
  | { type: 'resize', podId: string, sessionId: string, columns: number, rows: number }
  | { type: 'close', podId: string, sessionId: string }
export interface TerminalView { sessionId: string, podId: string, state: 'starting' | 'running' | 'closed', sequence: number, output: string, exitCode: number | null, error: string | null }
export function parseProgramCommand(value: unknown): ProgramCommand {
  const command = value as ProgramCommand
  if (!command || typeof command !== 'object' || Array.isArray(command) || !/^[a-f0-9-]{36}$/.test(command.podId)) throw new Error('Invalid program command')
  const keys: Record<ProgramCommand['type'], string[]> = { openShell: [], prepare: ['line'], add: ['epoch', 'source'], grant: ['applicationId', 'epoch', 'argv'], start: ['applicationId', 'epoch', 'argv'], importState: ['applicationId', 'epoch'], poll: ['sessionId', 'after'], input: ['sessionId', 'data'], resize: ['sessionId', 'columns', 'rows'], close: ['sessionId'] }
  if (!Object.hasOwn(keys, command.type) || Object.keys(command).some(key => !['type', 'podId', ...keys[command.type]].includes(key))) throw new Error('Unsupported program command')
  if (command.type === 'prepare' && (typeof command.line !== 'string' || command.line.length > 16000 || /[\0\r\n]/.test(command.line))) throw new Error('Invalid terminal command')
  if ('epoch' in command && (!Number.isSafeInteger(command.epoch) || command.epoch < 0)) throw new Error('Invalid application permission revision')
  if ('applicationId' in command && !/^[a-f0-9-]{36}$/.test(command.applicationId)) throw new Error('Invalid application identity')
  if ('sessionId' in command && !/^[a-f0-9-]{36}$/.test(command.sessionId)) throw new Error('Invalid terminal session')
  if (command.type === 'add' && !['o365-cli', 'choose'].includes(command.source)) throw new Error('Unsupported application source')
  if (command.type === 'start' || command.type === 'grant') parseProgramArgv(command.argv)
  if (command.type === 'poll' && (!Number.isSafeInteger(command.after) || command.after < 0)) throw new Error('Invalid terminal cursor')
  if (command.type === 'input' && (typeof command.data !== 'string' || new TextEncoder().encode(command.data).length > 8192)) throw new Error('Terminal input exceeds its limit')
  if (command.type === 'resize' && (!Number.isInteger(command.columns) || command.columns < 20 || command.columns > 500 || !Number.isInteger(command.rows) || command.rows < 5 || command.rows > 300)) throw new Error('Invalid terminal dimensions')
  return structuredClone(command)
}
export function parseProgramArgv(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64 || value.some(item => typeof item !== 'string' || item.length > 4096 || /[\0\r\n]/.test(item)) || JSON.stringify(value).length > 16000) throw new Error('Invalid program arguments')
  return [...value]
}
export function parseCommandLine(line: string): string[] {
  const args: string[] = []; let word = ''; let quote = ''; let started = false; let escape = false
  for (const character of line) {
    if (escape) { word += character; escape = false; started = true; continue }
    if (character === '\\' && quote !== '\'') { escape = true; continue }
    if (quote) { if (character === quote) quote = ''; else word += character; continue }
    if (character === '"' || character === '\'') { quote = character; started = true; continue }
    if (/\s/.test(character)) { if (started) { args.push(word); word = ''; started = false }; continue }
    if ('|;&<>`$'.includes(character)) throw new Error('Enter program arguments without shell operators')
    word += character; started = true
  }
  if (quote || escape) throw new Error('Close the quotation or escape in the command')
  if (started) args.push(word)
  return parseProgramArgv(args)
}

export function parseTerminalView(value: unknown): TerminalView {
  const view = value as TerminalView
  if (!view || typeof view !== 'object' || Array.isArray(view) || !/^[a-f0-9-]{36}$/.test(view.sessionId) || !/^[a-f0-9-]{36}$/.test(view.podId) || !['starting', 'running', 'closed'].includes(view.state) || !Number.isSafeInteger(view.sequence) || view.sequence < 0 || typeof view.output !== 'string' || new TextEncoder().encode(view.output).length > 128 * 1024 || (view.exitCode !== null && !Number.isInteger(view.exitCode)) || (view.error !== null && (typeof view.error !== 'string' || view.error.length > 16000))) throw new Error('Invalid terminal response')
  return { sessionId: view.sessionId, podId: view.podId, state: view.state, sequence: view.sequence, output: view.output, exitCode: view.exitCode, error: view.error }
}

export interface ConsoleView {
  workspace: string
  output: string
  command: Extract<ProgramCommand, { type: 'start' }> | null
  needsGrant: boolean
  permission: string | null
}
export function parseConsoleView(value: unknown): ConsoleView {
  const view = value as ConsoleView
  if (!view || typeof view !== 'object' || Array.isArray(view) || typeof view.workspace !== 'string' || !view.workspace.startsWith('/') || typeof view.output !== 'string' || view.output.length > 128 * 1024 || typeof view.needsGrant !== 'boolean' || (view.permission !== null && typeof view.permission !== 'string')) throw new Error('Invalid terminal context')
  if (view.command !== null && parseProgramCommand(view.command).type !== 'start') throw new Error('Invalid terminal command response')
  return { workspace: view.workspace, output: view.output, command: view.command, needsGrant: view.needsGrant, permission: view.permission }
}
