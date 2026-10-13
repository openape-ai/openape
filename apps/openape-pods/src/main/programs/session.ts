import { programLaunch, verifyProgramRuntime } from './runtime'
import type { DirectoryPolicy } from '../../runtime/directories'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { setTimeout as delay } from 'node:timers/promises'
import { loadAdapter, resolveCommand } from '@openape/apes'
import type { ProgramAssignment, TerminalView } from '../../contracts/programs'
import type { SandboxReach } from '../../contracts/sandbox'
import { launchTerminal } from '../../worker/runtime/terminal'
import { verifyExecutable } from '../../worker/runtime/sandbox'
import type { AgentConnection, GrantObserver, GrantLedgerPort, RunGrantTokens } from '../broker/authorization'
import { AgentAuthority } from '../broker/authorization'
import type { CredentialCache } from '../connections/cache'
import { registerAuthDomain } from '../connections/ledger'
import { startMailProxy } from '../mail/proxy'
import { inspectDomainRecords } from '../../worker/recovery/domains'
import { ProgramState } from './state'
import { assertGateOperation } from '../../contracts/mail-archive-port'

/** Read operations of an adapter; any other action is a write whose run is never replayed automatically. */
export const readActions = ['read', 'list', 'get']

/**
 * Resolves one application command inside the Pod sandbox: the assigned executable, runtime and adapter are
 * verified and the command must match an adapter operation. It does not decide the grant: the run's authority
 * matches the command to any recorded grant that covers it, and the IdP token must cover it as well.
 */
export async function resolveProgram(assignment: ProgramAssignment, argv: string[], action?: 'move') {
  await verifyExecutable(assignment.executable, assignment.executableHash)
  await verifyProgramRuntime(assignment)
  await verifyExecutable(assignment.adapterPath, assignment.adapterHash)
  for (const file of assignment.entryFiles) await verifyExecutable(file.path, file.hash)
  const adapter = loadAdapter(assignment.cliId, assignment.adapterPath)
  const command = [assignment.cliId, ...argv]
  const resolved = await resolveCommand(adapter, command)
  if (action && resolved.detail.action !== action) throw new Error('The archive port may only run the granted move operation')
  assertGateOperation(resolved.detail.action, action)
  return { write: !readActions.includes(resolved.detail.action), authorization: { grantId: '', command: { cliId: assignment.cliId, adapterPath: assignment.adapterPath, adapterDigest: adapter.digest, argv: command, coverage: [resolved.detail] } } }
}
/** What an adapter operation declares about its options; the fields after required_options come with declared-option adapters. */
interface DeclaredOptions { command: string[], required_options?: string[], value_options?: string[], flag_options?: string[], global_options?: string[] }
/**
 * Whether a token passes a declared option in exactly the dash form a getopt-style parser reads: `--name` or
 * `--name=value` for a declared name of two or more characters, and exactly `-x` for a declared one-letter name.
 * Bundles (`-abc`), `-longname`, attached values (`-Cvalue`) and `--x` for a one-letter name are never declared.
 */
function passesDeclared(token: string, names: Set<string>): boolean {
  if (token.startsWith('--')) {
    const name = token.slice(2).split('=', 1)[0]!
    return name.length > 1 && names.has(name)
  }
  return token.length === 2 && names.has(token[1]!)
}

/**
 * Fails closed on options for a command that runs with an object approval instead of a grant (issue 1468): every
 * option before the operation's command words must be a declared global option, every option after them a declared
 * option of the operation, each in its exact dash form. An undeclared option such as git's --upload-pack or -c is
 * refused, as is `--`.
 */
export function assertDeclaredOptions(operation: DeclaredOptions, argv: string[]): void {
  const undeclared = (token: string) => new Error(`The command passes ${token.split('=', 1)[0]}, which its adapter operation does not declare; an approved command runs only with declared options`)
  const globals = new Set((operation.global_options ?? []).map(entry => entry.split('=', 1)[0]!))
  let index = 0
  while (index < argv.length && !operation.command.every((word, offset) => argv[index + offset] === word)) {
    const token = argv[index]!
    if (!token.startsWith('-') || !passesDeclared(token, globals)) throw undeclared(token)
    if (token.startsWith('--') && token.includes('=')) { index += 1; continue }
    // Every global option takes a value; a missing or dash-led value would hide the next option from this check.
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('-')) throw undeclared(token)
    index += 2
  }
  const declared = new Set([...operation.required_options ?? [], ...operation.value_options ?? [], ...operation.flag_options ?? []])
  for (const token of argv.slice(index + operation.command.length)) {
    if (token.startsWith('-') && token.length > 1 && !passesDeclared(token, declared)) throw undeclared(token)
  }
}

/**
 * The adapter's description of one command that may run with an object approval: it must resolve to a declared,
 * non-generic adapter operation with only declared options, and a mail move stays with the archive service.
 */
export async function approvableCommand(assignment: ProgramAssignment, argv: string[]): Promise<string> {
  const loaded = loadAdapter(assignment.cliId, assignment.adapterPath)
  const resolved = await resolveCommand(loaded, [assignment.cliId, ...argv])
  assertGateOperation(resolved.detail.action)
  const operation = loaded.adapter.operations.find(item => item.id === resolved.detail.operation_id)
  if (!operation || resolved.detail.operation_id === '_generic.exec') throw new Error('An approved command must match an operation of the application adapter')
  assertDeclaredOptions(operation as DeclaredOptions, argv)
  return resolved.detail.display
}

export async function prepareProgramAuthorization(assignment: ProgramAssignment, connection: AgentConnection, argv: string[], observe?: GrantObserver, ledger?: GrantLedgerPort, action?: 'move', tokens?: RunGrantTokens) {
  const { authorization, write } = await resolveProgram(assignment, argv, action)
  return { authority: new AgentAuthority(connection, observe, ledger, tokens), authorization, write }
}

/** How a terminal reaches the Pod identity, its grant ledger and its sandbox reach. */
export interface ProgramAccess { connection: () => Promise<AgentConnection>, ledger: GrantLedgerPort, reach: () => Promise<SandboxReach> }

export class ProgramSession {
  private controller = new AbortController()
  private domain?: Awaited<ReturnType<typeof launchTerminal>>
  private chunks: { sequence: number, text: string }[] = []
  private sequence = 0
  private size = 0
  private state: TerminalView['state'] = 'starting'
  private exitCode: number | null = null
  private error: string | null = null
  readonly completed: Promise<void>
  constructor(readonly id: string, readonly podId: string, applicationId: string, assignment: ProgramAssignment, argv: string[], helper: string, root: string, credentials: CredentialCache, check: () => Promise<void>, release: () => Promise<void>, workspace: string, directories: DirectoryPolicy, access: ProgramAccess) {
    this.completed = this.run(applicationId, assignment, argv, helper, root, credentials, check, release, workspace, directories, access)
  }

  view(after = 0): TerminalView { return { sessionId: this.id, podId: this.podId, state: this.state, sequence: this.sequence, output: this.chunks.filter(item => item.sequence > after).map(item => item.text).join(''), exitCode: this.exitCode, error: this.error } }
  input(data: string): void {
    if (this.state !== 'running' || !this.domain) throw new Error('Terminal is not running')
    if (this.domain.channel.writableLength > 65536) throw new Error('Terminal input is waiting for the program')
    this.domain.channel.write(data)
  }

  close(): void { this.controller.abort(new Error('Terminal closed by the owner')); this.domain?.cancel() }
  private append(text: string): void {
    this.size += Buffer.byteLength(text)
    if (this.size > 128 * 1024) { this.controller.abort(new Error('Terminal output exceeds its limit')); this.domain?.cancel(); return }
    this.chunks.push({ sequence: ++this.sequence, text })
  }

  private async run(applicationId: string, assignment: ProgramAssignment, argv: string[], helper: string, root: string, credentials: CredentialCache, check: () => Promise<void>, release: () => Promise<void>, podWorkspace: string, directories: DirectoryPolicy, access: ProgramAccess): Promise<void> {
    const signal = this.controller.signal
    const deadline = setTimeout(() => this.controller.abort(new Error('Terminal session expired')), 15 * 60 * 1000)
    const directory = join(root, this.id); let verifiedClosed = true
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const { authority, authorization } = await prepareProgramAuthorization(assignment, await access.connection(), argv, undefined, access.ledger)
      await authority.authorize(authorization, signal)
      await check(); signal.throwIfAborted()
      const proxy = assignment.networkHosts.length && (await access.reach()).level === 'isolated' ? await startMailProxy(signal, undefined, assignment.networkHosts) : undefined
      try {
        await new ProgramState(credentials).use(assignment.stateId, { podId: this.podId, applicationId }, async (workspace) => {
          await check(); signal.throwIfAborted()
          const launch = programLaunch(assignment)
          const args = [...launch.prefix, ...argv, ...(assignment.cacheArgument ? [assignment.cacheArgument, workspace] : [])]
          const reach = await access.reach()
          const domain = await launchTerminal(helper, directory, { reach, executable: launch.executable, workspace: podWorkspace, readDirectories: directories.readDirectories, writeDirectories: [workspace, ...directories.writeDirectories], readFiles: assignment.entryFiles.map(file => file.path), runtimeDirectories: launch.runtimeDirectories, networkPorts: proxy ? [proxy.port] : [], systemTrust: Boolean(proxy) }, args, { ...launch.environment, ...proxy?.environment, HOME: workspace, TMPDIR: workspace }, (path, ownerPid) => registerAuthDomain(root, path, ownerPid))
          this.domain = domain; verifiedClosed = false
          const decoder = new StringDecoder('utf8')
          domain.stdout.on('data', (bytes: Buffer) => this.append(decoder.write(bytes)))
          domain.stderr.on('data', (bytes: Buffer) => this.append(bytes.toString()))
          const stop = () => domain.cancel(); signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop()
          const monitoring = new AbortController()
          const monitor = async () => {
            try { while (!monitoring.signal.aborted) { await delay(1000, undefined, { signal: monitoring.signal }); await check(); await authority.assertActive(authorization.grantId, AbortSignal.any([signal, monitoring.signal])) } }
            catch (error) { if (!monitoring.signal.aborted) { this.controller.abort(error); domain.cancel() } }
          }
          const watched = monitor()
          try { await domain.processId; this.state = 'running'; this.exitCode = await domain.completed; this.append(decoder.end()) }
          finally {
            monitoring.abort(); signal.removeEventListener('abort', stop); domain.cancel()
            try { await domain.completed; await inspectDomainRecords([{ path: domain.recordPath, owner_pid: process.pid }], root, helper); verifiedClosed = true }
            finally { await watched }
          }
        }, signal)
      }
      finally { await proxy?.close() }
    }
    catch (error) { this.error = error instanceof Error ? error.message : 'Application terminal failed' }
    finally {
      clearTimeout(deadline)
      if (verifiedClosed) {
        try { await release() }
        catch { this.error = 'Terminal closed but its pod lease needs recovery' }
      }
      this.state = 'closed'
    }
  }
}
