import { createHash, randomUUID } from 'node:crypto'
import type { OpenApeGrantSummary } from '@openape/core'
import { launchApeShell } from '../../worker/runtime/ape-shell'
import type { ApeShellRuntime } from '../../worker/runtime/ape-shell'
import { observeExecution } from '../programs/execution'
import type { ExecutionObserver } from '../programs/execution'
import { AuthorityError, NonRetryableError, PermissionUnavailableError } from '../../contracts/infrastructure'
import type { PermissionRefusal } from '../../contracts/infrastructure'
import { ProgramState } from '../programs/state'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, isAbsolute, sep } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { parseCredentialJSON } from '../connections/cache'
import type { CredentialCache } from '../connections/cache'
import { programHome, verifyExecutable } from '../../worker/runtime/sandbox'
import { podIdentityFile } from '../connections/identity-file'
import type { AgentConnection } from './authorization'
import type { SandboxReach } from '../../contracts/sandbox'

/** Authorizes one program call before it starts; a refusal throws. */
export interface ToolExecution {
  runtime: Omit<ApeShellRuntime, 'environment'>
  operationId: string
  targetHost: string
  summary?: OpenApeGrantSummary
  observer: ExecutionObserver
}
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
  isolation?: 'temporary'
  inputFiles?: { path: string, sha256: string }[]
  stdoutArtifact?: boolean
  approvalWaitMs?: number
  timeoutMs?: number
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
export interface ToolReply { refusal?: { reason: string } & Partial<PermissionRefusal>, pending?: { grantId: string, approvalUrl: string }, exitCode: number, stdout: string, stderr: string, stdoutArtifact?: { path: string, sha256: string, bytes: number } }
function secretStrings(value: unknown, key = ''): string[] {
  const credentialKeys = ['secret', 'token', 'accesstoken', 'refreshtoken', 'idtoken', 'refresh', 'privatekey', 'clientsecret', 'password', 'authorization']
  if (typeof value === 'string') return value && credentialKeys.includes(key.toLowerCase().replaceAll('_', '')) ? [value, JSON.stringify(value).slice(1, -1)] : []
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([childKey, child]) => secretStrings(child, childKey))
}

export class PodToolBroker {
  constructor(private readonly helper: string, private readonly root: string, private readonly execution: ToolExecution, private readonly credentials: CredentialCache) {}
  async execute(assignment: ToolAssignment, request: unknown, lease: BrokerLease): Promise<ToolReply> {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Invalid ape-shell request')
    const value = request as Record<string, unknown>
    if (Object.keys(value).some(key => !['toolId', 'argv'].includes(key)) || value.toolId !== assignment.id || !Array.isArray(value.argv) || JSON.stringify(value.argv) !== JSON.stringify(assignment.argv)) throw new Error('Command is outside the assigned tool call')
    lease.assertCurrent(); lease.signal.throwIfAborted()
    if (!lease.capabilities.includes(assignment.capability)) throw new Error('Script does not declare this capability')
    // A changed file is refused before the IdP is asked; launch checks the files again right before the process starts.
    await this.verifyFiles(assignment)
    // A program with a cache argument is authorized in launch, with the cache folder it actually receives.
    lease.assertCurrent(); lease.signal.throwIfAborted()
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    if (assignment.programState && assignment.reach?.level !== 'owner') {
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

  private async run(assignment: ToolAssignment, lease: BrokerLease, workspace: string, cache?: string): Promise<ToolReply> {
    const identity = assignment.identityConnection ? await podIdentityFile(this.root, assignment.identityConnection) : undefined
    let temporary = workspace
    let isolated: string | undefined
    try {
      if (assignment.reach?.level === 'owner') temporary = await mkdtemp(join(this.root, 'tmp-'))
      if (assignment.isolation === 'temporary') {
        isolated = await mkdtemp(join(this.root, 'isolated-'))
        const allowed = await Promise.all([lease.workspace, ...lease.readDirectories ?? [], ...lease.writeDirectories ?? []].filter((path): path is string => !!path).map(path => realpath(path)))
        for (const file of assignment.inputFiles ?? []) {
          if (await realpath(file.path) !== file.path || !allowed.some((root) => { const path = relative(root, file.path); return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)) })) throw new Error('Isolated input is outside assigned files')
          await verifyExecutable(file.path, file.sha256)
        }
      }
      const activeLease = identity ? { ...lease, signal: AbortSignal.any([lease.signal, identity.signal]) } : lease
      return await this.launch(assignment, activeLease, workspace, temporary, cache, identity, isolated)
    }
    finally {
      try { if (isolated) await rm(isolated, { recursive: true, force: true }); if (temporary !== workspace) await rm(temporary, { recursive: true, force: true }) }
      finally { await identity?.close() }
    }
  }

  private async launch(assignment: ToolAssignment, lease: BrokerLease, workspace: string, temporary: string, cache?: string, identity?: Awaited<ReturnType<typeof podIdentityFile>>, isolated?: string): Promise<ToolReply> {
    lease.assertCurrent(); lease.signal.throwIfAborted()
    const secrets = [...Object.values(assignment.environment).filter(Boolean), ...[assignment.environment.HTTPS_PROXY, assignment.environment.HTTP_PROXY].filter(Boolean).flatMap(url => new URL(url).password ? [new URL(url).password] : []), ...(cache ? secretStrings(parseCredentialJSON(await readFile(cache, 'utf8'))) : [])]
    // The process gets exactly the arguments the IdP authorized, after the owner-configured runtime prefix.
    const executed = [...assignment.argv, ...(cache && assignment.cacheArgument ? [assignment.cacheArgument, dirname(cache)] : [])]
    const args = [...assignment.prefix, ...executed]
    if (assignment.stdoutArtifact && !lease.workspace) throw new Error('Output artifacts require an assigned persistent workspace')
    const timeoutMs = assignment.timeoutMs ?? 60000
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw new Error('Invalid tool time bound')
    const limit = assignment.maxOutputBytes ?? 256 * 1024
    if (!Number.isSafeInteger(limit) || limit < 1024 || limit > 32 * 1024 * 1024) throw new Error('Invalid tool output bound')
    lease.assertCurrent(); lease.signal.throwIfAborted()
    // The authorized file hash must still hold when the process starts.
    await this.verifyFiles(assignment)
    const policy = { reach: assignment.reach, executable: assignment.executable, workspace: await realpath(lease.workspace ?? workspace), readDirectories: lease.readDirectories, writeDirectories: [...(lease.workspace ? [await realpath(workspace)] : []), ...(temporary === workspace ? [] : [await realpath(temporary)]), ...lease.writeDirectories ?? []], readFiles: [...assignment.entryFiles.map(file => file.path), ...(identity ? [identity.path] : [])], runtimeDirectories: assignment.runtimeDirectories, networkPorts: assignment.networkPorts, systemTrust: assignment.networkPorts.length > 0 }
    const environment = { ...assignment.runtimeEnvironment, ...assignment.environment, HOME: programHome(assignment.reach, workspace), TMPDIR: temporary, ...(identity ? { APES_AUTH_FILE: identity.path } : {}), ...(cache ? { POD_TOOL_AUTH_FILE: cache } : {}) }
    if (isolated) {
      policy.reach = { level: 'isolated', protectedPaths: [], deny: assignment.reach?.deny }
      policy.workspace = isolated; policy.readDirectories = []; policy.writeDirectories = []
      policy.readFiles = [...assignment.entryFiles.map(file => file.path), ...(assignment.inputFiles ?? []).map(file => file.path)]
      policy.networkPorts = []; policy.systemTrust = false
      environment.HOME = isolated; environment.TMPDIR = isolated
      delete environment.APES_AUTH_FILE; delete environment.POD_TOOL_AUTH_FILE
    }
    const execution = this.execution
    if (!identity) throw new Error('Program execution requires its assigned Pod identity')
    const domain = await launchApeShell(this.helper, this.root, policy, args, environment, {
      runtime: { ...execution.runtime, environment: { APES_AUTH_FILE: identity!.path, APES_IGNORE_USER_CONFIG: '1' } },
      operationId: execution.operationId,
      targetHost: execution.targetHost,
      executableHash: assignment.executableHash,
      files: [...assignment.entryFiles.map(file => ({ path: file.path, sha256: file.hash })), ...assignment.inputFiles ?? []],
      summary: execution.summary,
      waitMs: assignment.approvalWaitMs,
    }, lease.registerDomain)
    let stdout = ''; let stderr = ''; let failure: Error | undefined
    let outputBytes = 0
    const outDecoder = new StringDecoder('utf8'); const errDecoder = new StringDecoder('utf8')
    const stop = () => { failure ??= new Error('Tool call cancelled'); domain.cancel() }
    lease.signal.addEventListener('abort', stop, { once: true })
    if (lease.signal.aborted) stop()
    const append = (which: 'stdout' | 'stderr', bytes: Buffer) => {
      outputBytes += bytes.length
      if (outputBytes > limit || (assignment.stdoutArtifact && which === 'stderr' && Buffer.byteLength(stderr) + bytes.length > 64000)) { failure ??= new NonRetryableError(`Tool output exceeded ${limit} bytes; read smaller pages, for example with --limit`); domain.cancel(); return }
      if (which === 'stdout') stdout += outDecoder.write(bytes)
      else stderr += errDecoder.write(bytes)
    }
    domain.stdout.on('data', bytes => append('stdout', bytes)); domain.stderr.on('data', bytes => append('stderr', bytes))
    let deadline: ReturnType<typeof setTimeout> | undefined
    const armDeadline = () => { deadline = setTimeout(() => { failure = new Error('Tool call exceeded its time limit'); domain.cancel() }, timeoutMs) }
    try {
      await domain.processId
      const result = await observeExecution(domain, execution.operationId, { ...execution.observer, authorized: async (value) => { await execution.observer.authorized(value); armDeadline() } }, lease.signal)
      if (result.kind === 'pending') return { exitCode: 75, stdout: '', stderr: '', pending: { grantId: result.grantId, approvalUrl: result.approvalUrl } }
      const exitCode = result?.exitCode ?? await domain.completed
      stdout += outDecoder.end(); stderr += errDecoder.end()
      if (failure) throw failure
      lease.assertCurrent(); lease.signal.throwIfAborted()
      if (cache) secrets.push(...secretStrings(parseCredentialJSON(await readFile(cache, 'utf8'))))
      if (identity) secrets.push(...identity.secrets)
      for (const secret of secrets) { stdout = stdout.replaceAll(secret, '[REDACTED]'); stderr = stderr.replaceAll(secret, '[REDACTED]') }
      if (assignment.stdoutArtifact) {
        const path = join(await realpath(lease.workspace!), `.program-output-${randomUUID()}.json`)
        const bytes = Buffer.byteLength(stdout)
        await writeFile(path, stdout, { flag: 'wx', mode: 0o400 })
        return { exitCode, stdout: '', stderr, stdoutArtifact: { path, sha256: createHash('sha256').update(stdout).digest('hex'), bytes } }
      }
      return { exitCode, stdout, stderr }
    }
    catch (error) {
      // Only a verified private-channel not-started receipt may become a structured refusal.
      if (assignment.approvalWaitMs === 0 && error instanceof AuthorityError) return { exitCode: 126, stdout: '', stderr: '', refusal: { reason: error.message, ...(error instanceof PermissionUnavailableError ? error.permission : {}) } }
      throw error
    }
    finally {
      clearTimeout(deadline); lease.signal.removeEventListener('abort', stop)
      domain.cancel(); await domain.completed
    }
  }
}
