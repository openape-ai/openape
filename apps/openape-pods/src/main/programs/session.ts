import { programLaunch, verifyProgramRuntime } from './runtime'
import type { DirectoryPolicy } from '../../runtime/directories'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { setTimeout as delay } from 'node:timers/promises'
import { assertProgramName, commandLine, programIdentity } from '../../contracts/programs'
import type { ProgramAssignment, TerminalView } from '../../contracts/programs'
import type { SandboxReach } from '../../contracts/sandbox'
import { launchApeShell } from '../../worker/runtime/ape-shell'
import type { ApeShellRuntime } from '../../worker/runtime/ape-shell'
import { podIdentityFile } from '../connections/identity-file'
import { observeExecution } from './execution'
import { programHome, verifyExecutable } from '../../worker/runtime/sandbox'
import type { AgentConnection, GrantLedgerPort, ProgramCall } from '../broker/authorization'
import type { CredentialCache } from '../connections/cache'
import { registerAuthDomain } from '../connections/ledger'
import { startNetworkProxy } from '../network/proxy'
import { inspectDomainRecords } from '../../worker/recovery/domains'
import { ProgramState } from './state'
import { grantSummary } from '../../contracts/grant-summary'

/** Actions that only read; a call the IdP resolves to any other action is a write that is never replayed automatically. */
export const readActions = ['read', 'list', 'get']

/** Verifies the assigned program file, its runtime and entry files before a call is authorized. */
export async function verifyProgram(assignment: ProgramAssignment): Promise<void> {
  await verifyExecutable(assignment.executable, assignment.executableHash)
  await verifyProgramRuntime(assignment)
  for (const file of assignment.entryFiles) await verifyExecutable(file.path, file.hash)
}

/** One command of an assigned application as the IdP authorizes it: the program's name and file hash and the exact arguments. */
export function programCall(assignment: ProgramAssignment, argv: string[]): ProgramCall {
  assertProgramName(assignment.cliId)
  return { program: programIdentity(assignment), argv }
}

/** What the owner sees of one command a script asks approval for: the exact command line (issue 1468). */
export function describeCommand(assignment: ProgramAssignment, argv: string[]): string {
  return commandLine([assignment.cliId, ...argv])
}

/** How a terminal reaches the Pod identity, its grant ledger, its sandbox reach and its name for grant requests. */
export interface ProgramAccess { connection: () => Promise<AgentConnection>, ledger: GrantLedgerPort, reach: () => Promise<SandboxReach>, origin: () => Promise<string>, runtime: ApeShellRuntime }

export class ProgramSession {
  private controller = new AbortController()
  private domain?: Awaited<ReturnType<typeof launchApeShell>>
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
    // At the owner level the terminal gets the owner's HOME and this temporary folder, so neither lands in the saved application state.
    let identity: Awaited<ReturnType<typeof podIdentityFile>> | undefined
    const directory = join(root, this.id); const ownerTemporary = join(directory, 'tmp'); let verifiedClosed = true
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const connection = await access.connection()
      await verifyProgram(assignment)
      identity = await podIdentityFile(root, connection)
      await check(); signal.throwIfAborted()
      const reach = await access.reach()
      const proxy = assignment.networkHosts.length && reach.level === 'isolated' ? await startNetworkProxy(signal, assignment.networkHosts) : undefined
      try {
        const execute = async (workspace: string) => {
          await check(); signal.throwIfAborted()
          const launch = programLaunch(assignment)
          // The process gets exactly the arguments the IdP authorized, after the owner-configured runtime prefix.
          const executed = [...argv, ...(assignment.cacheArgument && reach.level !== 'owner' ? [assignment.cacheArgument, workspace] : [])]
          const args = [...launch.prefix, ...executed]
          const temporary = reach.level === 'owner' ? ownerTemporary : workspace
          if (temporary === ownerTemporary) await mkdir(temporary, { mode: 0o700 })
          await check(); signal.throwIfAborted()
          // The authorized file hash must still hold when the process starts.
          await verifyProgram(assignment)
          const domain = await launchApeShell(helper, directory, { reach, executable: launch.executable, workspace: podWorkspace, readDirectories: directories.readDirectories, writeDirectories: [...new Set([workspace, temporary]), ...directories.writeDirectories], readFiles: assignment.entryFiles.map(file => file.path), runtimeDirectories: launch.runtimeDirectories, networkPorts: proxy ? [proxy.port] : [], systemTrust: Boolean(proxy) }, args, { ...launch.environment, ...proxy?.environment, HOME: programHome(reach, workspace), TMPDIR: temporary }, { runtime: { ...access.runtime, environment: { ...access.runtime.environment, APES_AUTH_FILE: identity!.path, APES_IGNORE_USER_CONFIG: '1' } }, operationId: this.id, targetHost: connection.targetHost, executableHash: launch.executableHash, files: assignment.entryFiles.map(file => ({ path: file.path, sha256: file.hash })), summary: grantSummary('Run the selected application command', await access.origin()), waitMs: 15 * 60 * 1000 }, (path, ownerPid) => registerAuthDomain(root, path, ownerPid), true)
          this.domain = domain; verifiedClosed = false
          const decoder = new StringDecoder('utf8')
          domain.stdout.on('data', (bytes: Buffer) => this.append(decoder.write(bytes)))
          domain.stderr.on('data', (bytes: Buffer) => this.append(bytes.toString()))
          const stop = () => domain.cancel(); signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop()
          const monitoring = new AbortController()
          const monitor = async () => {
            try { while (!monitoring.signal.aborted) { await delay(1000, undefined, { signal: monitoring.signal }); await check(); identity!.assertActive() } }
            catch (error) { if (!monitoring.signal.aborted) { this.controller.abort(error); domain.cancel() } }
          }
          const watched = monitor()
          try {
            const result = await observeExecution(domain, this.id, {
              pending: async (_id, url) => { this.append(`Waiting for approval at ${url}\n`) },
              authorized: async () => { await check(); await verifyProgram(assignment); identity!.assertActive() },
              starting: () => { this.state = 'running' },
            }, signal)
            if (result.kind !== 'completed') throw new Error('Application command is still awaiting approval')
            this.exitCode = result.exitCode; this.append(decoder.end())
          }
          finally {
            monitoring.abort(); signal.removeEventListener('abort', stop); domain.cancel()
            try { await domain.completed; await inspectDomainRecords([{ path: domain.recordPath, owner_pid: process.pid }], root, helper); verifiedClosed = true }
            finally { await watched }
          }
        }
        if (reach.level === 'owner') await execute(ownerTemporary)
        else await new ProgramState(credentials).use(assignment.stateId, { podId: this.podId, applicationId }, execute, signal)
      }
      finally { await proxy?.close(); await rm(ownerTemporary, { recursive: true, force: true }) }
    }
    catch (error) { this.error = error instanceof Error ? error.message : 'Application terminal failed' }
    finally {
      clearTimeout(deadline)
      await identity?.close()
      if (verifiedClosed) {
        try { await release() }
        catch { this.error = 'Terminal closed but its pod lease needs recovery' }
      }
      this.state = 'closed'
    }
  }
}
