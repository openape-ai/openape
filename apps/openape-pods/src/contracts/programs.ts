import { parseHttpPermission } from './http'

export interface ProgramRuntime {
  executable: string
  executableHash: string
  arguments: string[]
  readDirectories: string[]
  environment: Record<string, string>
  descriptor: { path: string, hash: string }
}

export interface ProgramDefinition {
  runtime?: ProgramRuntime
  name: string
  icon?: string
  bundlePath?: string
  executable: string
  executableHash: string
  cliId: string
  adapterPath: string
  adapterHash: string
  /** The shapes-registry entry the adapter file was verified against when it was assigned (issue 1473). */
  registry?: { id: string, digest: string }
  /** What the adapter's version command printed for this executable when it was assigned. */
  cliVersion?: { version: string | null, tested: boolean }
  networkHosts: string[]
  cacheArgument?: '--cache-dir'
  entryFiles: { path: string, hash: string }[]
  environment: Record<string, string>
}
/** Pods assigns only shapes-registry adapters (issue 1473); an adapter file path is never accepted. */
export const registryAdaptersOnly = 'Pods assigns only shapes-registry adapters; leave out adapterPath and install the registry adapter with apes adapter install <name>'

/**
 * How far an assigned adapter is trusted (issue 1473). A tested registry adapter resolves commands to the grants its
 * operations describe. An adapter that is not from the registry, or whose CLI version is unknown or untested, only
 * describes a command: every command then needs a grant for its exact argv. Pods' generated application launcher
 * has a single exact no-argument operation and stays as it is.
 */
export type AdapterStanding = { exact: false } | { exact: true, reason: 'notFromRegistry' | 'versionUnknown' | 'versionUntested' }
export function adapterStanding(definition: Pick<ProgramDefinition, 'registry' | 'cliVersion' | 'bundlePath'>): AdapterStanding {
  if (definition.bundlePath) return { exact: false }
  if (!definition.registry) return { exact: true, reason: 'notFromRegistry' }
  if (!definition.cliVersion?.version) return { exact: true, reason: 'versionUnknown' }
  return definition.cliVersion.tested ? { exact: false } : { exact: true, reason: 'versionUntested' }
}
/** An application in the Pod sandbox. What it may run is decided by Pod grants, recorded apart from it. */
export interface ProgramAssignment extends ProgramDefinition {
  type: 'program'
  stateId: string
  capability: string
}
export type ProgramCommand =
  | { type: 'network', podId: string, applicationId: string, epoch: number, hosts: string[] }
  | { type: 'openShell', podId: string }
  | { type: 'openFolder', podId: string }
  | { type: 'prepare', podId: string, line: string }
  | { type: 'add', podId: string, epoch: number, suggestedName?: string }
  | { type: 'replace', podId: string, applicationId: string, epoch: number }
  | { type: 'launch', podId: string, applicationId: string, epoch: number }
  | { type: 'launchStatus', podId: string }
  | { type: 'grant', podId: string, applicationId: string, epoch: number, argv: string[] }
  | { type: 'start', podId: string, applicationId: string, epoch: number, argv: string[] }
  | { type: 'importState', podId: string, applicationId: string, epoch: number }
  | { type: 'poll', podId: string, sessionId: string, after: number }
  | { type: 'input', podId: string, sessionId: string, data: string }
  | { type: 'close', podId: string, sessionId: string }
export interface TerminalView { sessionId: string, podId: string, state: 'starting' | 'running' | 'closed', sequence: number, output: string, exitCode: number | null, error: string | null }
export function parseProgramCommand(value: unknown): ProgramCommand {
  const command = value as ProgramCommand
  if (!command || typeof command !== 'object' || Array.isArray(command) || !/^[a-f0-9-]{36}$/.test(command.podId)) throw new Error('Invalid program command')
  const keys: Record<ProgramCommand['type'], string[]> = { network: ['applicationId', 'epoch', 'hosts'], openShell: [], openFolder: [], launchStatus: [], prepare: ['line'], add: ['epoch', 'suggestedName'], replace: ['applicationId', 'epoch'], launch: ['applicationId', 'epoch'], grant: ['applicationId', 'epoch', 'argv'], start: ['applicationId', 'epoch', 'argv'], importState: ['applicationId', 'epoch'], poll: ['sessionId', 'after'], input: ['sessionId', 'data'], close: ['sessionId'] }
  if (!Object.hasOwn(keys, command.type) || Object.keys(command).some(key => !['type', 'podId', ...keys[command.type]].includes(key))) throw new Error('Unsupported program command')
  if (command.type === 'add' && command.suggestedName !== undefined && (typeof command.suggestedName !== 'string' || command.suggestedName.length > 255 || /[\0\r\n]/.test(command.suggestedName))) throw new Error('Invalid application name')
  if (command.type === 'prepare' && (typeof command.line !== 'string' || command.line.length > 16000 || /[\0\r\n]/.test(command.line))) throw new Error('Invalid terminal command')
  if ('epoch' in command && (!Number.isSafeInteger(command.epoch) || command.epoch < 0)) throw new Error('Invalid application permission revision')
  if ('applicationId' in command && !/^[a-f0-9-]{36}$/.test(command.applicationId)) throw new Error('Invalid application identity')
  if ('sessionId' in command && !/^[a-f0-9-]{36}$/.test(command.sessionId)) throw new Error('Invalid terminal session')
  if (command.type === 'start' || command.type === 'grant') parseProgramArgv(command.argv)
  if (command.type === 'poll' && (!Number.isSafeInteger(command.after) || command.after < 0)) throw new Error('Invalid terminal cursor')
  if (command.type === 'input' && (typeof command.data !== 'string' || new TextEncoder().encode(command.data).length > 8192)) throw new Error('Terminal input exceeds its limit')
  if (command.type === 'network') return { ...command, hosts: parseNetworkHosts(command.hosts) }
  return structuredClone(command)
}
export function parseNetworkHosts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 16 || value.some(host => typeof host !== 'string' || host.length > 253)) throw new Error('Choose up to 16 public HTTPS hostnames')
  const hosts = value.map((host) => {
    const permission = parseHttpPermission({ origin: `https://${host}`, methods: ['GET'] })
    const hostname = new URL(permission.origin).hostname
    if (host.toLowerCase() !== hostname) throw new Error('Enter a hostname without scheme, path or port')
    return hostname
  })
  if (new Set(hosts).size !== hosts.length) throw new Error('Application network hosts must be unique')
  return hosts
}
export function parseProgramArgv(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64 || value.some(item => typeof item !== 'string' || item.length > 4096 || /[\0\r\n]/.test(item)) || JSON.stringify(value).length > 16000) throw new Error('Invalid program arguments')
  return [...value]
}
/** One exact application command and the program approval it runs with (issue 1468). */
export interface ApprovedInvocation { application: string, argv: string[], approval: string }

/** A script's tools.invoke with an `approval`, and the same call from the worker to the desktop. */
export function parseApprovedInvocation(value: unknown): ApprovedInvocation {
  const input = value as Record<string, unknown> | null
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['application', 'argv', 'approval'].includes(key)) || typeof input.application !== 'string' || !input.application || typeof input.approval !== 'string' || !/^[\w-]{1,64}$/.test(input.approval)) throw new Error('An approved command names its application, exact argv and approval')
  return { application: input.application, argv: parseProgramArgv(input.argv), approval: input.approval }
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
