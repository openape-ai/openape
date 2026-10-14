import { programLaunch, verifyProgramRuntime } from './runtime'
import type { DirectoryPolicy } from '../../runtime/directories'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { setTimeout as delay } from 'node:timers/promises'
import { assertProgramName, commandLine, programIdentity } from '../../contracts/programs'
import type { ProgramAssignment, TerminalView } from '../../contracts/programs'
import type { SandboxReach } from '../../contracts/sandbox'
import { launchTerminal } from '../../worker/runtime/terminal'
import { programHome, verifyExecutable } from '../../worker/runtime/sandbox'
import type { AgentConnection, CommandAuthorization, GrantLedgerPort, ProgramCall } from '../broker/authorization'
import { AgentAuthority } from '../broker/authorization'
import type { CredentialCache } from '../connections/cache'
import { registerAuthDomain } from '../connections/ledger'
import { startMailProxy } from '../mail/proxy'
import { inspectDomainRecords } from '../../worker/recovery/domains'
import { ProgramState } from './state'
import { archivePortPrograms, gateActions, mailProgramActions } from '../../contracts/mail-archive-port'
import { approvalURL } from '../../contracts/activity'

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

/**
 * What the IdP's answer means for the run (issue 1473, revision 4): the verified command token carries the IdP's own
 * resolution of exactly this call (`authorization_details`, the generic exact-command detail for a program the
 * registry does not describe). The call is a read only when every resolved action reads; any other action, or none, makes
 * it a write. Mail moves and archives (gate actions) run only through the approved archive port. Outside it, a call of a
 * mail program with an archive port (by its command name or any program the token resolved) is refused unless every action is a
 * known non-moving one, so an exact-command fallback can never move mail.
 */
export function callEffect(authorization: CommandAuthorization, program: string, port?: 'move'): { write: boolean } {
  if (port === 'move' && !authorization.actions.includes('move')) throw new Error('The archive port may only run the granted move operation')
  // The IdP selects the shape by the tested program hash, so a resolved mail shape follows the binary, not its local name.
  const mailProgram = [program, ...authorization.programs].some(name => archivePortPrograms.includes(name.toLowerCase()))
  const refused = (action: string) => gateActions.includes(action) || (mailProgram && !mailProgramActions.includes(action))
  if (port !== 'move' && (authorization.actions.some(refused) || (mailProgram && !authorization.actions.length))) throw new Error('Moving or archiving mail runs only through the approved archive service')
  return { write: !authorization.actions.length || authorization.actions.some(action => !readActions.includes(action)) }
}

/** What the owner sees of one command a script asks approval for: the exact command line (issue 1468). */
export function describeCommand(assignment: ProgramAssignment, argv: string[]): string {
  return commandLine([assignment.cliId, ...argv])
}

/** How a terminal reaches the Pod identity, its grant ledger, its sandbox reach and its name for grant requests. */
export interface ProgramAccess { connection: () => Promise<AgentConnection>, ledger: GrantLedgerPort, reach: () => Promise<SandboxReach>, origin: () => Promise<string> }

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
    // At the owner level the terminal gets the owner's HOME and this temporary folder, so neither lands in the saved application state.
    const directory = join(root, this.id); const ownerTemporary = join(directory, 'tmp'); let verifiedClosed = true
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      // A pending approval is shown in the terminal with its IdP page; the session waits for the owner's decision.
      const authority = new AgentAuthority(await access.connection(), async (progress) => { if (progress.state === 'pending') this.append(`Waiting for approval at ${approvalURL(progress)}\n`) }, access.ledger, undefined, { origin: await access.origin() })
      const authorize = async (executed: string[]) => {
        const granted = await authority.authorizeProgram(programCall(assignment, executed), signal)
        callEffect(granted, assignment.cliId)
        return granted
      }
      await verifyProgram(assignment)
      // A program with a cache argument is authorized below, with the state folder it actually receives.
      let authorization = assignment.cacheArgument ? undefined : await authorize(argv)
      await check(); signal.throwIfAborted()
      const proxy = assignment.networkHosts.length && (await access.reach()).level === 'isolated' ? await startMailProxy(signal, undefined, assignment.networkHosts) : undefined
      try {
        await new ProgramState(credentials).use(assignment.stateId, { podId: this.podId, applicationId }, async (workspace) => {
          await check(); signal.throwIfAborted()
          const launch = programLaunch(assignment)
          // The process gets exactly the arguments the IdP authorized, after the owner-configured runtime prefix.
          const executed = [...argv, ...(assignment.cacheArgument ? [assignment.cacheArgument, workspace] : [])]
          authorization ??= await authorize(executed)
          const granted = authorization
          const args = [...launch.prefix, ...executed]
          const reach = await access.reach()
          const temporary = reach.level === 'owner' ? ownerTemporary : workspace
          if (temporary === ownerTemporary) await mkdir(temporary, { mode: 0o700 })
          await check(); signal.throwIfAborted()
          // The authorized file hash must still hold when the process starts.
          await verifyProgram(assignment)
          const domain = await launchTerminal(helper, directory, { reach, executable: launch.executable, workspace: podWorkspace, readDirectories: directories.readDirectories, writeDirectories: [...new Set([workspace, temporary]), ...directories.writeDirectories], readFiles: assignment.entryFiles.map(file => file.path), runtimeDirectories: launch.runtimeDirectories, networkPorts: proxy ? [proxy.port] : [], systemTrust: Boolean(proxy) }, args, { ...launch.environment, ...proxy?.environment, HOME: programHome(reach, workspace), TMPDIR: temporary }, (path, ownerPid) => registerAuthDomain(root, path, ownerPid))
          this.domain = domain; verifiedClosed = false
          const decoder = new StringDecoder('utf8')
          domain.stdout.on('data', (bytes: Buffer) => this.append(decoder.write(bytes)))
          domain.stderr.on('data', (bytes: Buffer) => this.append(bytes.toString()))
          const stop = () => domain.cancel(); signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop()
          const monitoring = new AbortController()
          const monitor = async () => {
            try { while (!monitoring.signal.aborted) { await delay(1000, undefined, { signal: monitoring.signal }); await check(); await authority.assertActive(granted.grantId, AbortSignal.any([signal, monitoring.signal])) } }
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
      finally { await proxy?.close(); await rm(ownerTemporary, { recursive: true, force: true }) }
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
