import { NonRetryableError } from '../../contracts/infrastructure'
import { ProgramState } from '../programs/state'
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { parseCredentialJSON } from '../connections/cache'
import type { CredentialCache } from '../connections/cache'
import { launchSandbox, programHome, verifyExecutable } from '../../worker/runtime/sandbox'
import { podIdentityFile } from '../connections/identity-file'
import type { AgentConnection, ProgramCall } from './authorization'
import type { SandboxReach } from '../../contracts/sandbox'

/** Authorizes one program call before it starts; a refusal throws. */
export type CallAuthority = (call: ProgramCall, signal: AbortSignal) => Promise<unknown>
export interface ToolAssignment {
  identityConnection?: AgentConnection
  reach?: SandboxReach
  id: string
  programState?: { id: string, podId: string, applicationId: string }
  capability: string
  /** The program the call names at the IdP; its file must still have `sha256` right before the call is authorized. */
  program: { path: string, name: string, sha256: string }
  /** The arguments exactly as executed, without the executable. */
  argv: string[]
  /** What starts: the program itself, or the runtime its descriptor names. */
  executable: string
  executableHash: string
  entryFiles: { path: string, hash: string }[]
  prefix: string[]
  connectionId?: string
  cacheArgument?: '--cache-dir'
  maxOutputBytes?: number
  runtimeDirectories: string[]
  environment: Record<string, string>
  runtimeEnvironment?: Record<string, string>
  networkPorts: number[]
}
export interface BrokerLease {
  readDirectories?: string[]
  writeDirectories?: string[]
  workspace?: string
  registerDomain?: (path: string, ownerPid: number) => void | Promise<void>
  capabilities: string[]
  assertCurrent: () => void
  signal: AbortSignal
}
export interface ToolReply { exitCode: number, stdout: string, stderr: string }
function secretStrings(value: unknown, key = ''): string[] {
  const credentialKeys = ['secret', 'token', 'accesstoken', 'refreshtoken', 'idtoken', 'refresh', 'privatekey', 'clientsecret', 'password', 'authorization']
  if (typeof value === 'string') return value && credentialKeys.includes(key.toLowerCase().replaceAll('_', '')) ? [value, JSON.stringify(value).slice(1, -1)] : []
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([childKey, child]) => secretStrings(child, childKey))
}

export class PodToolBroker {
  constructor(private readonly helper: string, private readonly root: string, private readonly authorize: CallAuthority, private readonly credentials: CredentialCache) {}
  async execute(assignment: ToolAssignment, request: unknown, lease: BrokerLease): Promise<ToolReply> {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Invalid ape-shell request')
    const value = request as Record<string, unknown>
    if (Object.keys(value).some(key => !['toolId', 'argv'].includes(key)) || value.toolId !== assignment.id || !Array.isArray(value.argv) || JSON.stringify(value.argv) !== JSON.stringify(assignment.argv)) throw new Error('Command is outside the assigned tool call')
    lease.assertCurrent(); lease.signal.throwIfAborted()
    if (!lease.capabilities.includes(assignment.capability)) throw new Error('Script does not declare this capability')
    // A changed file is refused before the IdP is asked; launch checks the files again right before the process starts.
    await this.verifyFiles(assignment)
    // A program with a cache argument is authorized in launch, with the cache folder it actually receives.
    if (!assignment.cacheArgument) await this.authorize(this.call(assignment, assignment.argv), lease.signal)
    lease.assertCurrent(); lease.signal.throwIfAborted()
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    if (assignment.programState) {
      const state = assignment.programState
      return new ProgramState(this.credentials).use(state.id, state, async directory => this.run(assignment, lease, directory, assignment.cacheArgument ? join(directory, 'token.json') : undefined), lease.signal)
    }
    if (assignment.connectionId) {
      return this.credentials.withCache(assignment.connectionId, async (cache) => {
        lease.assertCurrent(); lease.signal.throwIfAborted()
        return this.run(assignment, lease, dirname(cache), cache)
      }, lease.signal)
    }
    const workspace = await mkdtemp(join(this.root, 'tool-'))
    try { return await this.run(assignment, lease, workspace) }
    finally { await rm(workspace, { recursive: true, force: true }) }
  }

  private async verifyFiles(assignment: ToolAssignment): Promise<void> {
    await verifyExecutable(assignment.program.path, assignment.program.sha256)
    await verifyExecutable(assignment.executable, assignment.executableHash)
    for (const file of assignment.entryFiles) await verifyExecutable(file.path, file.hash)
  }

  private call(assignment: ToolAssignment, argv: string[]): ProgramCall {
    return { program: { name: assignment.program.name, sha256: assignment.program.sha256 }, argv }
  }

  /**
   * At the owner level the program gets the owner's HOME and a temporary folder of its own, so neither its temporary
   * files nor the owner's settings land in the saved application state; the isolated level keeps both in `workspace`.
   */
  private async run(assignment: ToolAssignment, lease: BrokerLease, workspace: string, cache?: string): Promise<ToolReply> {
    const identity = assignment.identityConnection ? await podIdentityFile(this.root, assignment.identityConnection) : undefined
    let temporary = workspace
    try {
      if (assignment.reach?.level === 'owner') temporary = await mkdtemp(join(this.root, 'tmp-'))
      const activeLease = identity ? { ...lease, signal: AbortSignal.any([lease.signal, identity.signal]) } : lease
      return await this.launch(assignment, activeLease, workspace, temporary, cache, identity)
    }
    finally {
      try { if (temporary !== workspace) await rm(temporary, { recursive: true, force: true }) }
      finally { await identity?.close() }
    }
  }

  private async launch(assignment: ToolAssignment, lease: BrokerLease, workspace: string, temporary: string, cache?: string, identity?: Awaited<ReturnType<typeof podIdentityFile>>): Promise<ToolReply> {
    lease.assertCurrent(); lease.signal.throwIfAborted()
    const secrets = [...Object.values(assignment.environment).filter(Boolean), ...[assignment.environment.HTTPS_PROXY, assignment.environment.HTTP_PROXY].filter(Boolean).flatMap(url => new URL(url).password ? [new URL(url).password] : []), ...(cache ? secretStrings(parseCredentialJSON(await readFile(cache, 'utf8'))) : [])]
    // The process gets exactly the arguments the IdP authorized, after the owner-configured runtime prefix.
    const executed = [...assignment.argv, ...(cache && assignment.cacheArgument ? [assignment.cacheArgument, dirname(cache)] : [])]
    if (assignment.cacheArgument) await this.authorize(this.call(assignment, executed), lease.signal)
    const args = [...assignment.prefix, ...executed]
    const limit = assignment.maxOutputBytes ?? 256 * 1024
    if (!Number.isSafeInteger(limit) || limit < 1024 || limit > 32 * 1024 * 1024) throw new Error('Invalid tool output bound')
    lease.assertCurrent(); lease.signal.throwIfAborted()
    // The authorized file hash must still hold when the process starts.
    await this.verifyFiles(assignment)
    const domain = await launchSandbox(this.helper, this.root, { reach: assignment.reach, executable: assignment.executable, workspace: await realpath(lease.workspace ?? workspace), readDirectories: lease.readDirectories, writeDirectories: [...(lease.workspace ? [await realpath(workspace)] : []), ...(temporary === workspace ? [] : [await realpath(temporary)]), ...lease.writeDirectories ?? []], readFiles: [...assignment.entryFiles.map(file => file.path), ...(identity ? [identity.path] : [])], runtimeDirectories: assignment.runtimeDirectories, networkPorts: assignment.networkPorts, systemTrust: assignment.networkPorts.length > 0 }, args, { ...assignment.runtimeEnvironment, ...assignment.environment, HOME: programHome(assignment.reach, workspace), TMPDIR: temporary, ...(identity ? { APES_AUTH_FILE: identity.path } : {}), ...(cache ? { POD_TOOL_AUTH_FILE: cache } : {}) }, lease.registerDomain)
    let stdout = ''; let stderr = ''; let failure: Error | undefined
    let outputBytes = 0
    const outDecoder = new StringDecoder('utf8'); const errDecoder = new StringDecoder('utf8')
    const stop = () => { failure ??= new Error('Tool call cancelled'); domain.cancel() }
    lease.signal.addEventListener('abort', stop, { once: true })
    if (lease.signal.aborted) stop()
    const append = (which: 'stdout' | 'stderr', bytes: Buffer) => {
      outputBytes += bytes.length
      if (outputBytes > limit) { failure ??= new NonRetryableError(`Tool output exceeded ${limit} bytes; read smaller pages, for example with --limit`); domain.cancel(); return }
      if (which === 'stdout') stdout += outDecoder.write(bytes)
      else stderr += errDecoder.write(bytes)
    }
    domain.stdout.on('data', bytes => append('stdout', bytes)); domain.stderr.on('data', bytes => append('stderr', bytes))
    const deadline = setTimeout(() => { failure = new Error('Tool call exceeded its time limit'); domain.cancel() }, 60000)
    try {
      await domain.processId
      const exitCode = await domain.completed
      stdout += outDecoder.end(); stderr += errDecoder.end()
      if (failure) throw failure
      lease.assertCurrent(); lease.signal.throwIfAborted()
      if (cache) secrets.push(...secretStrings(parseCredentialJSON(await readFile(cache, 'utf8'))))
      if (identity) secrets.push(...identity.secrets)
      for (const secret of secrets) { stdout = stdout.replaceAll(secret, '[REDACTED]'); stderr = stderr.replaceAll(secret, '[REDACTED]') }
      return { exitCode, stdout, stderr }
    }
    finally {
      clearTimeout(deadline); lease.signal.removeEventListener('abort', stop)
      domain.cancel(); await domain.completed
    }
  }
}
