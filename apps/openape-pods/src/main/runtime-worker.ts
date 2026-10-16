import type { CliRequest } from '../contracts/cli'
import type { ProgramCall, GrantPresentation  } from './broker/authorization'
import { executeRecordedProgram } from './programs/effect-execution'
import type { ProgramExecutionCheck } from '../contracts/program-execution'
import { podIdentityFile } from './connections/identity-file'
import type { InboxOutboxCommand } from '../worker/inbox/outbox'
import type { DecisionSources, InboxDecisions } from './inbox/decisions'
import { parseInboxDecide } from '../contracts/inbox'
import { readOnlyAction } from './codex/routing'
import { applicationBundle, applicationDefinition } from './programs/application'
import { parseSharingCommand } from '../contracts/sharing'
import type { PortableImportCommand, SharingCommand, SharingState } from '../contracts/sharing'
import { parseDefinitionCommand, parseDefinitionsView } from '../contracts/definitions'
import type { DefinitionCommand, DefinitionsView } from '../contracts/definitions'
import { resolveSshTarget, sshGrantArgv } from './ssh/configuration'
import { invokeSsh } from './ssh/invoke'
import { AuthorityError, InfrastructureError, NonRetryableError } from '../contracts/infrastructure'
import type { InfrastructureFailure } from '../contracts/infrastructure'
import { releaseApprovalGrants } from './gates/handler'
import { assignedJev, parseJevRequest, typesafeOrigin } from '../contracts/jev'
import { executeJev } from './connections/jev-service'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import type { CentralController, CentralGate } from './central/controller'
import type { CentralCommand, CentralSnapshot } from '../contracts/central'
import { centralId, parseCentralCommand, parseInboxCentralCommand } from '../contracts/central'
import { administrationActions, parseAdministration } from '../contracts/codex-admin'
import type { AdministrationJournal, AdministrationReceipt } from '../contracts/codex-admin'
import { importPrivateSecret } from './codex/secret-import'
import { SecretsGate } from './secrets/gate'
import type { ConsumerRecord } from './secrets/gate'
import type { SecretRequestRow, SecretsCommand, SecretsView } from '../contracts/secrets'
import type { SecretRowCommand } from '../worker/secrets/store'
import { installedProgramDefinition } from './programs/definition'
import { modelResources } from '../worker/master/resources'
import { sameOwner } from '@openape/pods-protocol'
import type { RemoteInternal } from '../worker/remote/registration'
import type { Owner } from '@openape/pods-protocol'
import type { DomainCommand, DomainOverview } from '../contracts/domain-admin'
import type { RunContextRequest, ServiceCheck, ServiceRequest  } from '../contracts/services'
import { approvalURL } from '../contracts/activity'
import type { RunApproval } from '../contracts/activity'
import { assignedDirectories, directoryPolicy } from '../runtime/directories'
import { podEnvironment, podEnvironmentValues, visibleEnvironment } from '../runtime/environment'
import { podWorkspace } from './programs/console'
import { invokeProgram, programRequest } from './programs/invoke'
import { administerGrants, administerSandbox } from './grants/administration'
import type { Administration } from './grants/administration'
import { ProgramManager } from './programs/manager'
import { PodGrants, httpSpec, sshSpec } from './grants/pod-grants'
import type { GrantSpec } from './grants/pod-grants'
import type { OwnerSession } from './connections/owner-session'
import { apesLogin } from './connections/apes-login'
import { pendingApprovals } from './inbox/approvals'
import type { ApesLogin } from './connections/apes-login'
import type { GrantLedgerCommand } from '../worker/resources/grants'
import type { SandboxReach, SandboxView } from '../contracts/sandbox'
import { deniedPaths, ownerProtectedPaths, programHome } from '../worker/runtime/sandbox'
import { controlSocketProtection } from './codex/socket-path'
import { homedir } from 'node:os'
import type { ProgramDefinition, ProgramCommand } from '../contracts/programs'
import type { ProgramInternal } from '../worker/resources/programs'
import { parseHttpPermission, parseHttpRequest } from '../contracts/http'
import { grantView } from '../contracts/grants'
import { executeHttp } from './programs/http-service'
import type { AgentBearer } from './programs/http-service'
import { DdisaAgentTokens } from './programs/ddisa-agent'
import { parseCredentialRead } from '../contracts/credentials'
import { parseScriptView } from '../contracts/scripts'
import type { ScriptCommand, ScriptView } from '../contracts/scripts'
import { assertPilotRuntime } from './support'
import { parseDataView } from '../contracts/data'
import type { DataView } from '../contracts/data'
import type { DataInternal } from '../worker/data/control'
import type { DeletionJob } from '../worker/data/retention'
import { ConnectionManager } from './connections/manager'
import type { SetupInternal } from '../worker/onboarding/control'
import { startAgentGateway } from '../worker/agent/gateway'
import type { OnboardingCommand, OnboardingView } from '../contracts/onboarding'
import { parseMasterView } from '../contracts/master'
import { boundedCodexResult, parseDesktopAction, parseWorkspaceAction, workspaceHelp } from '../contracts/codex'
import type { CodexRequest, DesktopAction } from '../contracts/codex'
import type { MasterCommand, MasterView } from '../contracts/master'
import { realpathSync } from 'node:fs'
import { parseRunContext, parseServiceScope, serviceKinds } from '../contracts/services'
import type { CredentialCache } from './connections/cache'
import type { RuntimeHost, RuntimeChild } from './runtime-host'
import { RunGrantTokens } from './broker/authorization'
import { grantSummary, parseScriptSummary } from '../contracts/grant-summary'
import { parsePodDetails } from '../contracts/details'
import type { DetailsCommand, PodDetails } from '../contracts/details'
import { parseScheduleView } from '../contracts/scheduling'
import type { ScheduleCommand, ScheduleView } from '../contracts/scheduling'
import { parseRunView } from '../contracts/runs'
import type { RunCommand, RunView } from '../contracts/runs'
import { parseResourceState } from '../contracts/resources'
import type { InternalResourceCommand, ResourceState } from '../contracts/resources'
import { createHash, randomUUID } from 'node:crypto'
import { parseWorkspace } from '../contracts/control'
import type { WorkspaceCommand, WorkspaceState } from '../contracts/control'
import { basename, dirname, join } from 'node:path'
import type { WorkerStatus } from '../contracts/ipc'
import type { ApprovalManifest } from '../contracts/approvals'
import { parseStorageFailure, storageReadinessMs } from '../contracts/storage'
import { automaticBackupDirectory } from './storage-recovery'
import type { StorageFailure } from '../contracts/storage'

const secretsOrigin = 'https://secrets.openape.ai'
// Waiting calls are parked outside the service limit, but bounded per run and in total.
const parkedPerRun = 4
const parkedTotal = 64
// A fixed record id in the encrypted store for this Mac's consumer key at OpenApe Secrets.
const secretsConsumerRecord = '6f0c2d2e-5b1a-4f0e-9c7d-3a2b1c0d9e8f'

/**
 * The Pod name as the owner reads it in the runtime grant at the IdP: one line without control or
 * format characters and at most 100 characters. The Pod id stays in the structured authorization.
 */
export function grantPodName(name: string): string {
  return name.replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim().slice(0, 100) || 'Pod'
}

function redactTerminalInput(action: Record<string, unknown>): Record<string, unknown> {
  const command = action.command as { type?: string, data?: unknown }
  if (command?.type !== 'input' || typeof command.data !== 'string') return action
  return { ...action, command: { ...command, data: `sha256:${createHash('sha256').update(command.data).digest('hex')}` } }
}
function redactTerminalView(result: unknown): unknown {
  const view = result as { sessionId?: unknown, state?: unknown, sequence?: unknown, exitCode?: unknown, error?: unknown } | null
  return view && typeof view === 'object' ? { sessionId: view.sessionId, state: view.state, sequence: view.sequence, exitCode: view.exitCode, error: view.error } : null
}

export class RuntimeWorker {
  central: CentralController | null = null
  inbox: InboxDecisions | null = null
  private apesLogin: ApesLogin | null = null
  // Keep the assigned identity alive; ape-shell owns runtime grants and their revocation monitor.
  private shellIdentities = new Map<string, { refresh: (signal: AbortSignal) => Promise<void>, close: () => Promise<void> }>()
  private runTokens = new Map<string, RunGrantTokens>()
  private openedApprovals = new Set<string>()
  private cliStarts = new Map<string, { scriptHash: string, owner: OwnerSession, runId?: string }>()
  private programs: ProgramManager | null = null
  private connections: ConnectionManager | null = null
  private grants: PodGrants | null = null
  private secretsGate: SecretsGate | null = null
  // When a failed grant release may be tried again; failures never block processing.
  private readonly releaseRetry = new Map<string, { at: number, failures: number }>()
  private providerGateway: Awaited<ReturnType<typeof startAgentGateway>> | null = null
  private providerAbort = new AbortController()
  private jevAttempts = new Map<string, number>()
  private setupReady: Promise<void> | null = null
  private child: RuntimeChild | null = null
  private stopping = false
  private root = ''
  private profileBase = ''
  private credentials: CredentialCache | null = null
  private readonly agentTokens = new DdisaAgentTokens()
  private services = new Map<string, AbortController>()
  // Service calls (id → run) that wait for the owner's IdP decision; they execute nothing and hold no slot.
  private parked = new Map<string, string>()
  private pending = new Map<string, { resolve: (state: unknown) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout> }>()
  private state: WorkerStatus = { state: 'starting', pid: null, error: null }
  private centralAction(type: string): CentralController | null {
    if (!this.central || this.central.executing) return null
    if (!this.central.available) throw new Error(this.central.offlineMessage())
    return ['list', 'gateOpen'].includes(type) ? null : this.central
  }

  constructor(private readonly publish: (status: WorkerStatus) => void, private readonly host: RuntimeHost) {}
  private get directory(): string { return this.host.directory ?? join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/') }

  start(root: string, profileBase: string): void {
    try { assertPilotRuntime() }
    catch (error) { this.state = { state: 'error', pid: null, error: error instanceof Error ? error.message : 'Unsupported Mac' }; this.publish(this.state); return }
    this.root = realpathSync(root)
    this.profileBase = profileBase
    this.credentials = this.host.credentials(join(this.root, 'credentials'))
    const fixturePort = process.env.NODE_ENV === 'test' ? process.env.OPENAPE_PODS_FIXTURE_MODEL_PORT : undefined
    if (fixturePort && (!/^\d+$/.test(fixturePort) || Number(fixturePort) < 1024 || Number(fixturePort) > 65535)) throw new Error('Invalid synthetic model port')
    // Synthetic fixtures freeze approval batches at once instead of collecting inputs for two minutes.
    const fixtureGates = process.env.NODE_ENV === 'test' && !!process.env.OPENAPE_PODS_FIXTURE_DIR
    this.child = this.host.fork(join(this.directory, 'worker/entry.cjs'), { cwd: root, env: { HOME: root, TMPDIR: root, PATH: '/usr/bin:/bin', PODS_RUNTIME_EXECUTABLE: process.execPath, PODS_BACKUP_DIRECTORY: automaticBackupDirectory(profileBase), ...(process.env.OPENAPE_PODS_CENTRAL_ENABLED === '1' ? { PODS_CENTRAL_ENABLED: '1' } : {}), ...(this.host.oneShot ? { PODS_ONESHOT: '1', PODS_PROFILE_LEASE: '1' } : {}), ...(fixturePort ? { PODS_FIXTURE_MODEL_PORT: fixturePort } : {}), ...(fixtureGates ? { PODS_FIXTURE_GATE_COLLECT: '0' } : {}) }, serviceName: 'OpenApe Pods Fixture Worker', stdio: 'pipe' })
    const child = this.child
    const reportError = (error: string) => { this.state = { state: 'error', pid: child.pid ?? null, error }; this.publish(this.state) }
    let storage: StorageFailure | undefined
    this.state = { state: 'starting', pid: child.pid ?? null, error: null }
    // The window never waits on the database: without a readiness report in time it shows recovery, nothing runs.
    const deadline = setTimeout(() => {
      if (this.child !== child || this.state.state !== 'starting') return
      storage = { reason: 'timeout', message: `Storage did not report readiness within ${storageReadinessMs / 1000} seconds; automation stays stopped`, at: Date.now() }
      this.state = { state: 'recovery', pid: child.pid ?? null, error: storage.message, storage }; this.publish(this.state)
    }, storageReadinessMs)
    child.on('message', (message: unknown) => {
      if (message && typeof message === 'object' && 'storage' in message) {
        try { storage = parseStorageFailure(message.storage) }
        catch { storage = { reason: 'unknown', message: 'Storage reported an unreadable failure', at: Date.now() } }
        return
      }
      if (message && typeof message === 'object' && 'executionIdentity' in message) {
        const request = message.executionIdentity as { id: string, action: string, podId?: string, purpose?: string }
        const respond = async () => {
          if (!request || !/^[a-f0-9-]{36}$/.test(request.id)) throw new Error('Invalid execution identity request')
          if (request.action === 'release') {
            this.services.get(request.id)?.abort(); this.services.delete(request.id)
            await this.shellIdentities.get(request.id)?.close(); this.shellIdentities.delete(request.id)
            return
          }
          if (request.action !== 'acquire' || !request.podId || !/^[a-f0-9-]{36}$/.test(request.podId) || !['validation', 'dependencies'].includes(request.purpose!) || this.services.has(request.id) || !this.connections) throw new Error('Execution identity is unavailable')
          const controller = new AbortController(); this.services.set(request.id, controller)
          const connection = await this.connections.podConnection(request.podId)
          const identity = await podIdentityFile(this.root, connection)
          try {
            controller.signal.throwIfAborted()
            if (this.child !== child) throw new Error('Owning worker stopped')
            this.shellIdentities.set(request.id, { refresh: async () => identity.assertActive(), close: identity.close })
            child.postMessage({ executionIdentityReply: { id: request.id, machine: { runtime: { executable: process.execPath, cli: this.host.apesCli, environment: { APES_AUTH_FILE: identity.path, APES_IGNORE_USER_CONFIG: '1' } }, targetHost: connection.targetHost, summary: grantSummary(request.purpose === 'validation' ? 'Validate the selected script with synthetic services' : 'Prepare the selected script dependencies', await this.podName(request.podId)), waitMs: 15 * 60 * 1000 } } })
          }
          catch (error) { await identity.close(); throw error }
        }
        void respond().catch((error: unknown) => {
          this.services.delete(request?.id)
          if (this.child === child) child.postMessage({ executionIdentityReply: { id: request?.id, error: error instanceof Error ? error.message : 'Execution identity failed' } })
        })
        return
      }
      if (message && typeof message === 'object' && 'programCancel' in message) { this.programs?.cancelPod(String(message.programCancel)); return }
      if (message && typeof message === 'object' && 'serviceCancel' in message) { this.services.get(String(message.serviceCancel))?.abort(new Error('Pod tool call cancelled')); return }
      if (message && typeof message === 'object' && 'service' in message) {
        const request = message.service as ServiceRequest
        const respond = async () => {
          let reply: { id: string, value?: unknown, error?: string, infrastructure?: InfrastructureFailure, authority?: boolean, nonRetryable?: boolean }
          try { reply = { id: request.id, value: await this.executeService(request) } }
          catch (error) { reply = { id: request.id, error: error instanceof Error ? error.message : 'Mail broker failed', ...(error instanceof AuthorityError ? { authority: true } : {}), ...(error instanceof NonRetryableError ? { nonRetryable: true } : {}), ...(error instanceof InfrastructureError && ['http', 'shell', 'tool'].includes(request.kind ?? 'tool') ? { infrastructure: error.failure } : {}) } }
          if (this.child === child) child.postMessage({ serviceReply: reply })
        }
        void respond().catch((error: unknown) => { console.error('Broker response failed', error); child.kill() })
        return
      }
      if (message !== 'ready') {
        const reply = message as { id?: string, state?: unknown, error?: string }
        const request = reply && typeof reply.id === 'string' ? this.pending.get(reply.id) : undefined
        if (!request || !reply.id) { reportError('Unexpected worker message'); child.kill(); return }
        this.pending.delete(reply.id); clearTimeout(request.timer)
        try { if (reply.error) throw new Error(reply.error); request.resolve(reply.state) }
        catch (error) { request.reject(error instanceof Error ? error : new Error('Invalid worker response')) }
        return
      }
      clearTimeout(deadline); storage = undefined
      this.state = { state: 'ready', pid: child.pid ?? null, error: null }
      this.setupReady = (async () => { if (!this.host.oneShot) await this.initializeConnections(); this.publish(this.state) })().catch((error: unknown) => { reportError(error instanceof Error ? error.message : 'Connection setup failed') })
    })
    child.on('exit', (code) => {
      this.programs?.cancelAll()
      void this.closeShellIdentities().catch((error: unknown) => { console.error('Pod shell credential cleanup failed', error) })
      for (const service of this.services.values()) service.abort(new Error('Owning worker stopped'))
      clearTimeout(deadline)
      this.state = this.stopping ? { state: 'stopped', pid: null, error: null } : storage ? { state: 'recovery', pid: null, error: storage.message, storage } : { state: 'error', pid: null, error: `Worker exited (${code}). Quit and reopen Pods to recover.` }
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Worker stopped before replying')) }
      this.pending.clear()
      this.child = null; this.publish(this.state)
    })
    child.stderr?.on('data', (data: Buffer) => { console.error('[pods worker]', data.toString()) })
  }

  private async initializeConnections(): Promise<void> {
    const dist = this.directory
    const runtime = { helper: join(dist, 'native/pods-helper'), executable: process.execPath, entry: join(dist, 'runtime/script-entry.mjs'), runtimeDirectories: [dirname(dirname(process.execPath))], environment: { ELECTRON_RUN_AS_NODE: '1' }, binary: join(dist, 'vendor/codex'), catalog: join(dist, 'vendor/models.json'), manifest: join(dist, 'vendor/manifest.json'), sdkHost: join(dist, 'runtime/sdk-host.mjs') }
    this.connections = new ConnectionManager(this.root, runtime, this.credentials!, command => this.dispatch({ setup: command }), async () => {
      const ready = await this.connections!.providerReady()
      await this.dispatch({ provider: ready && this.providerGateway ? { port: this.providerGateway.port, capability: this.providerGateway.capability } : null })
    }, !!process.env.OPENAPE_PODS_FIXTURE_DIR && process.env.NODE_ENV === 'test', this.host.oneShot ? this.host.jevKey : undefined)
    this.providerGateway = await startAgentGateway({ provider: (body, signal) => this.connections!.provider(body, signal), model: signal => this.connections!.model(signal), tool: async () => { throw new Error('Model credential gateway has no tools') } }, this.providerAbort.signal)
    const connections = this.connections
    const grants = this.podGrants()!
    this.programs = new ProgramManager(join(this.root, 'authentication'), runtime.helper, this.credentials!, this.connections, podId => this.resources({ type: 'list', podId }), command => this.dispatch({ program: command }), podId => ({ connection: () => connections.podConnection(podId), ledger: grants.port(podId), reach: () => this.sandboxReach(podId), origin: () => this.podName(podId), runtime: { executable: process.execPath, cli: this.host.apesCli, environment: {} } }))
    await this.connections.initialize(async () => {
      await this.dispatch({ inspectCredentials: true })
      if (this.host.oneShot) return
      await this.credentials!.reconcileScriptSecrets(await this.dispatch({ credentialInventory: true }) as { id: string, podId: string }[])
      await this.finishDeletions()
      await this.migrateHttpCredentials()
    }, !this.host.oneShot)
    if (this.host.oneShot) return
    this.secretsGate = new SecretsGate({
      origin: secretsOrigin,
      fetch: (input, init) => fetch(input, init),
      ownerToken: signal => this.connections!.ownerBearer(signal),
      consumer: {
        load: async () => {
          try { return await this.credentials!.readConnection(secretsConsumerRecord) as unknown as ConsumerRecord }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
        },
        save: record => this.credentials!.connect(secretsConsumerRecord, JSON.stringify(record)),
        erase: () => this.credentials!.eraseConnection(secretsConsumerRecord),
      },
      rows: {
        list: () => this.secretRows({ type: 'list' }),
        record: async (row) => { await this.secretRows({ type: 'record', row }) },
        update: async (id, patch) => { await this.secretRows({ type: 'update', id, patch }) },
      },
      store: async (podId, alias, value) => { await this.saveSecret(podId, alias, value) },
    })
    this.secretsGate.start()
  }

  private async secretRows(command: SecretRowCommand): Promise<SecretRequestRow[]> { return await this.dispatch({ secrets: command }) as SecretRequestRow[] }

  /** The existing credential path with the current resource epoch; the value never leaves this process. */
  private async saveSecret(podId: string, alias: string, value: string): Promise<void> {
    const { epoch } = parseResourceState(await this.dispatch({ resource: { type: 'list', podId } }))
    await this.resources({ type: 'saveCredential', podId, alias, value, epoch })
  }

  async importSecretFile(podId: string, alias: string, path: string): Promise<void> {
    await importPrivateSecret(path, value => this.saveSecret(podId, alias, value))
  }

  async secrets(command: SecretsCommand): Promise<SecretsView> {
    if (!this.secretsGate) throw new Error('OpenApe Secrets is unavailable until the desktop is set up')
    if (command.type === 'request') await this.secretsGate.request(command.podId, command.alias, command.purpose)
    if (command.type === 'cancel') await this.secretsGate.cancel(command.id)
    if (command.type === 'revokeConsumer') await this.secretsGate.revoke()
    if (command.type === 'importFile') throw new Error('The private file is chosen in the owner window')
    return this.secretsGate.view()
  }

  private async finishDeletions(): Promise<void> {
    const jobs = await this.dispatch({ data: { type: 'jobs' } }) as DeletionJob[]
    for (const job of jobs) { await this.connections!.purgePodKeys(job.podId, job.keyIds); await this.dispatch({ data: { type: 'finishDeletion', podId: job.podId } }) }
  }

  private updateFrozen = false

  async prepareUpdate(): Promise<void> {
    await this.setupReady
    if (this.updateFrozen || this.pending.size || this.connections?.busy() || this.programs?.busy() || this.services.size > this.parked.size) throw new Error('Finish active work and account setup before installing the update')
    this.updateFrozen = true
    try { await this.dispatch({ data: { type: 'prepareUpdate' } }) }
    catch (error) { this.updateFrozen = false; throw error }
  }

  async releaseUpdate(): Promise<void> {
    await this.dispatch({ data: { type: 'releaseUpdate' } })
    this.updateFrozen = false
  }

  async data(command: DataInternal): Promise<DataView> {
    const coordinatedDeletion = command.type === 'deletePod' && this.central?.executing
    if (this.central && !coordinatedDeletion && command.type !== 'status' && command.type !== 'backup') throw new Error('Central workspaces require coordinated backup and retention; local deletion and restore are disabled')
    await this.setupReady
    if (command.type !== 'status' && (this.connections?.busy() || this.programs?.busy())) throw new Error('Finish or cancel account setup before changing application data')
    const view = parseDataView(await this.dispatch({ data: command }))
    if (command.type === 'cleanup' || command.type === 'deletePod') { await this.finishDeletions(); return parseDataView(await this.dispatch({ data: { type: 'status' } })) }
    return view
  }

  cancelProgram(podId: string): void { this.programs?.cancelPod(podId) }

  private async closeShellIdentities(): Promise<void> {
    const starts = [...this.cliStarts.values()]; this.cliStarts.clear()
    await Promise.all(starts.map(start => start.owner.close()))
    const identities = [...this.shellIdentities.values()]; this.shellIdentities.clear(); this.runTokens.clear(); this.jevAttempts.clear()
    await Promise.all(identities.map(identity => identity.close()))
  }

  /** An installed program by its path and file hash, with an optional runtime descriptor (issue 1473, revision 4). */
  async installedProgram(path: string, options: { runtimePath?: string } = {}): Promise<ProgramDefinition> {
    return installedProgramDefinition(path, { ...options, protectedRoots: [this.root, this.profileBase, ...await this.writableFolders()] })
  }

  /** Every folder assigned to a Pod for writing. */
  private async writableFolders(): Promise<string[]> {
    const pods = parseWorkspace(await this.dispatch({ type: 'list' })).pods
    const states = await Promise.all(pods.map(async pod => parseResourceState(await this.dispatch({ resource: { type: 'list', podId: pod.id } }))))
    return states.flatMap(state => state.resources.filter(item => item.kind === 'directory' && item.state === 'ready' && item.configuration.access === 'readWrite').map(item => String(item.configuration.path)))
  }

  async program(command: ProgramCommand, definition?: ProgramDefinition, file?: string): Promise<Awaited<ReturnType<ProgramManager['terminal']>> | Awaited<ReturnType<ProgramManager['prepare']>> | ResourceState | string | null> {
    const central = this.centralAction(['launchStatus', 'prepare', 'poll', 'input', 'close'].includes(command.type) ? 'list' : command.type)
    if (central) return central.local(() => this.program(command, definition, file))
    await this.setupReady
    if (!this.programs) throw new Error('Program service is not ready')
    if (command.type === 'launchStatus') return this.programs.launchStatus(command.podId)
    if (command.type === 'openFolder') throw new Error('The Pod folder opens from the owner window')
    if (command.type === 'openShell') {
      const dist = this.directory
      return this.programs.openShell(command.podId, { executable: process.execPath, cli: this.host.apesCli, client: join(dist, 'runtime/shell-client.mjs') })
    }
    if (command.type === 'launch') {
      const dist = this.directory
      return this.programs.launch(command, { executable: process.execPath, cli: this.host.apesCli, client: join(dist, 'runtime/shell-client.mjs') })
    }
    if (command.type === 'prepare') return this.programs.prepare(command.podId, command.line)
    if (command.type === 'add') {
      if (!definition) throw new Error('Choose an application in the owner window')
      await this.programs.add(command.podId, command.epoch, definition)
    }
    else if (command.type === 'replace') {
      if (!definition) throw new Error('Choose an application in the owner window')
      await this.programs.replace(command.podId, command.applicationId, command.epoch, definition)
    }
    else if (command.type === 'network') {
      await this.programs.network(command.podId, command.applicationId, command.epoch, command.hosts)
    }
    else if (command.type === 'grant') {
      await this.grantProgram(command, null)
    }
    else if (command.type === 'importState') {
      if (!file) throw new Error('Choose an application state file in the owner window')
      await this.programs.importFile(command.podId, command.applicationId, command.epoch, file)
    }
    else {
      return this.programs.terminal(command)
    }
    return this.resources({ type: 'list', podId: command.podId })
  }

  /**
   * Asks the IdP about one command as the Pod (issue 1473, revision 4): a covered command needs nothing; a pending request
   * is approved right away in an owner session, otherwise its IdP page opens.
   */
  private async grantProgram(command: Extract<ProgramCommand, { type: 'grant' }>, owner: OwnerSession | null): Promise<string | null> {
    await this.setupReady
    const grants = this.podGrants()
    if (!this.programs || !grants) throw new Error('Program service is not ready')
    const { grantId, approval } = await grants.requestProgram(command.podId, await this.programs.grantCall(command), AbortSignal.timeout(120000))
    if (!approval) return null
    if (owner) { await grants.approve(owner, command.podId, grantId, 'always', AbortSignal.timeout(60000)); return null }
    await this.host.openExternal(approval)
    return approval
  }

  /** The Pod grants of the connected owner; null until the connection service is set up. */
  private podGrants(): PodGrants | null {
    const connections = this.connections
    if (!connections) return null
    this.grants ??= new PodGrants({ connection: podId => connections.podConnection(podId), ledger: command => this.dispatch({ grants: command }), podName: podId => this.podName(podId) })
    return this.grants
  }

  /** The sandbox reach of a Pod: its level and denylist plus the paths every Pod is denied. */
  async sandboxReach(podId: string): Promise<SandboxReach> {
    const view = await this.dispatch({ grants: { type: 'sandbox', podId } }) as SandboxView
    return { level: view.level, protectedPaths: [...ownerProtectedPaths(this.root, this.profileBase, homedir()), ...controlSocketProtection(this.profileBase)], deny: deniedPaths(view.deny, homedir()) }
  }

  /** The Pod's resources with its sandbox; a saved denylist replaces the Pod's entries. */
  private async sandboxState(podId: string, deny?: string[]): Promise<ResourceState> {
    if (deny) await this.dispatch({ grants: { type: 'deny', podId, deny } })
    const [state, sandbox] = await Promise.all([this.dispatch({ resource: { type: 'list', podId } }), this.dispatch({ grants: { type: 'sandbox', podId } })])
    return { ...parseResourceState(state), sandbox: sandbox as SandboxView }
  }

  async onboarding(command: OnboardingCommand): Promise<OnboardingView> {
    await this.setupReady
    if (!this.connections) throw new Error('Connection setup is not ready')
    return this.connections.execute(command)
  }

  inboxOutbox(command: InboxOutboxCommand): Promise<unknown> { return this.dispatch({ inboxOutbox: command }) }

  /** Revokes always grants of finished object approvals at the IdP; a failure is logged and retried later with backoff. */
  /** Pending Pod grants the owner decides at the IdP page, read there again so Entscheidungen shows their current state. */
  async refreshPendingGrants(signal: AbortSignal): Promise<void> {
    await this.setupReady
    await this.podGrants()?.refreshPending(signal)
  }

  async releaseApprovalGrants(signal: AbortSignal): Promise<void> {
    if (!this.connections) return
    // Brokered Pod grants are revoked by the owner (issue 1462); the sweep derives that session from the apes login
    // only when a brokered grant needs it, and closing it never touches the login.
    let session: Promise<OwnerSession | null> | undefined
    const owner = () => session ??= this.mcpApesSession(Date.now() + 5 * 60000, signal)
    try { await this.releaseApprovals(this.connections, signal, owner) }
    // A failed derivation was already reported by the revoke that needed it; only an open session is closed here.
    finally { if (session) await (await session.catch(() => null))?.close() }
  }

  private async releaseApprovals(connections: ConnectionManager, signal: AbortSignal, owner: () => Promise<OwnerSession | null>): Promise<void> {
    for (const release of await this.dispatch({ approvalRelease: { type: 'list' } }) as { podId: string, manifest: ApprovalManifest, grants: { key: string, id: string }[] }[]) {
      const id = `approval:${release.manifest.batchId}`
      const retry = this.releaseRetry.get(id)
      if (retry && retry.at > Date.now()) continue
      try {
        await releaseApprovalGrants(release, connections, signal, owner)
        await this.dispatch({ approvalRelease: { type: 'released', keys: release.grants.map(grant => grant.key) } })
        this.releaseRetry.delete(id)
      }
      catch (error) {
        const failures = (retry?.failures ?? 0) + 1
        this.releaseRetry.set(id, { at: Date.now() + Math.min(60 * 60000, 60000 * 2 ** failures), failures })
        console.error(`Could not release the grants of approval batch ${release.manifest.batchId}`, error)
      }
    }
  }

  async remote(command: RemoteInternal): Promise<unknown> { return this.dispatch({ remote: command }) }
  async remoteOwner(): Promise<{ owner: Owner, email: string }> {
    await this.setupReady
    if (!this.connections) throw new Error('Connection service unavailable')
    return this.connections.remoteOwner()
  }

  async mcpOwnerSession(endsAt: number, signal: AbortSignal, present: (value: { url: string }) => void): Promise<OwnerSession> {
    await this.setupReady
    if (!this.connections) throw new Error('Connection service unavailable')
    return this.connections.ownerSession(endsAt, signal, present)
  }

  async mcpApesSession(endsAt: number, signal: AbortSignal): Promise<OwnerSession | null> {
    await this.setupReady
    if (!this.connections) throw new Error('Connection service unavailable')
    return this.connections.apesOwnerSession(endsAt, signal, this.ownerApesLogin())
  }

  // The bundled apes CLI renews an expired key login under its own lock; Pods only reads the login.
  private ownerApesLogin(): ApesLogin {
    this.apesLogin ??= apesLogin({ executable: process.execPath, script: this.host.apesCli })
    return this.apesLogin
  }

  /** How many grants wait for the owner at the IdP, for the account inbox (issue 1458). */
  readonly inboxApprovals = pendingApprovals(() => this.ownerApesLogin(), async () => {
    const { owner, email } = await this.remoteOwner()
    return { issuer: owner.issuer, email }
  })

  async indexRemotePods(owner: Owner): Promise<void> {
    await this.setupReady
    if (!this.connections) throw new Error('Connection service unavailable')
    const bindings = await this.connections.existingRemotePods(owner)
    if (this.central) {
      const workspace = parseWorkspace(await this.dispatch({ type: 'list' }))
      for (const pod of workspace.pods) {
        if (bindings.some(binding => binding.podId === pod.id)) continue
        bindings.push({ podId: pod.id, identity: await this.provisionRemotePod(pod.id, owner) })
      }
    }
    for (const binding of bindings) await this.remote({ type: 'claim', podId: binding.podId, owner, identity: binding.identity })
  }

  async provisionRemotePod(podId: string, owner: Owner) {
    await this.setupReady
    if (!this.connections) throw new Error('Connect the owner account on desktop')
    return (await this.connections.podConnection(podId, owner)).identity
  }

  async cli(command: CliRequest): Promise<unknown> {
    const central = this.centralAction(command.command.type)
    if (central) return central.local(() => this.cli(command))
    if (command.channel === 'workspace') return this.request(command.command)
    if (command.channel === 'scripts') {
      if (command.command.type !== 'list') await this.executionReady()
      return this.scripts(command.command)
    }
    if (command.command.type === 'start') {
      await this.executionReady()
      if (!this.host.oneShot || !command.command.expectedScript) throw new Error('An owner CLI start requires its selected script')
      const owner = await this.mcpApesSession(Date.now() + 15 * 60000, AbortSignal.timeout(30000))
      if (!owner) throw new Error('Sign in as the Pod owner with apes before starting a Pod')
      const podId = command.command.podId
      if (this.cliStarts.has(podId)) { await owner.close(); throw new Error('This Pod already has a pending owner start') }
      this.cliStarts.set(podId, { scriptHash: command.command.expectedScript, owner })
      try { return await this.dispatch({ cliRun: command.command }) }
      catch (error) { this.cliStarts.delete(podId); await owner.close(); throw error }
    }
    return this.runs(command.command)
  }

  async executionReady(): Promise<void> {
    await this.setupReady
    if (!this.connections) { this.setupReady = this.initializeConnections(); await this.setupReady }
  }

  async codex(request: CodexRequest, owner: OwnerSession | null = null): Promise<unknown> {
    if (request.action.action === 'workspace') {
      const query = parseWorkspaceAction(request.action)
      if (!this.central) throw new Error('Connect the central workspace in the desktop app first')
      if (query.type === 'reconcile') return this.central.reconcile(query.id as string, query.applied as boolean, query.evidence as string)
      return this.central.query(query)
    }
    if (request.action.action === 'runtime') return { ...await this.dispatch({ codex: request }) as object, workspace: workspaceHelp, ...(this.central ? { central: this.central.status() } : {}) }
    const reading = readOnlyAction(request.action)
    if (!reading && this.central && !this.central.executing) return this.central.local(() => this.codex(request, owner))
    if (request.action.action === 'desktop') {
      const action = parseDesktopAction(request.action)
      return boundedCodexResult(reading ? await this.desktop(action) : await this.journal(request, () => this.desktop(action)))
    }
    if (!administrationActions.includes(String(request.action.action))) {
      const result = await this.dispatch({ codex: request, ownerOperation: this.central?.executing === true })
      if (request.action.action === 'create') {
        const podId = centralId((result as { id: string }).id)
        if (this.central) await this.centralProvision(podId, (await this.remoteOwner()).owner)
      }
      return result
    }
    const action = parseAdministration(request.action)
    if (action.kind === 'grants' || action.kind === 'sandbox') return boundedCodexResult(reading ? await this.administer(action, owner) : await this.journal(request, () => this.administer(action, owner)))
    // Terminal output and input can hold device codes or typed secrets; the receipt keeps only their shape.
    const terminal = action.kind === 'program' && ['start', 'poll', 'input', 'close'].includes(action.command.type)
    const journaled = terminal ? { ...request, action: redactTerminalInput(request.action) } : request
    try { return await this.journal(journaled, () => this.administer(action, owner), result => terminal ? redactTerminalView(result) : result) }
    catch (error) {
      if (action.kind === 'importSecret' || action.kind === 'importJev') throw new Error('Secret import failed; inspect the private file, current Pod revision and resource epoch before retrying')
      throw error
    }
  }

  /** Same requestId and arguments return the recorded result; an interrupted or failed request is never repeated. */
  private async journal(request: CodexRequest, work: () => Promise<unknown>, stored: (result: unknown) => unknown = result => result): Promise<unknown> {
    const receipt = await this.dispatch({ codexAdministration: { type: 'begin', request } }) as AdministrationReceipt
    if (receipt.completed) return receipt.result
    try {
      const result = await work()
      await this.dispatch({ codexAdministration: { type: 'complete', request, result: stored(result) } })
      return result
    }
    catch (error) {
      await this.dispatch({ codexAdministration: { type: 'failed', request } })
      throw error
    }
  }

  private desktop(action: DesktopAction): Promise<unknown> {
    if (action.channel === 'definitions') return this.definitions(action.command)
    if (action.channel === 'scheduling') return this.scheduling(action.command)
    return this.request(action.command)
  }

  private async administer(action: ReturnType<typeof parseAdministration>, owner: OwnerSession | null): Promise<unknown> {
    await this.setupReady
    if (action.kind === 'grants') {
      if (!this.podGrants()) throw new Error('Connection setup is not ready')
      return administerGrants(action.command, owner, this.administration())
    }
    if (action.kind === 'sandbox') {
      if (!this.podGrants()) throw new Error('Connection setup is not ready')
      return administerSandbox(action.command, owner, this.administration())
    }
    const { command } = action
    if (action.kind === 'importJev') {
      const before = await this.resources({ type: 'list', podId: command.podId })
      if (before.epoch !== action.command.epoch) throw new Error('Pod permissions changed; reload before importing Jev')
      if (before.jev) throw new Error('A Jev connection already exists; replace it through App settings')
      await importPrivateSecret(action.path, key => this.onboarding({ type: 'saveTypesafe', key }))
      return { jev: (await this.resources({ type: 'list', podId: command.podId })).jev }
    }
    if (action.kind === 'description') return { description: (await this.details(action.command)).description }
    if (action.kind === 'scripts') {
      const view = await this.scripts(action.command)
      return { pod: view.pod, resourceEpoch: view.resourceEpoch, credentialAliases: view.credentialAliases, drafts: view.drafts, versions: view.versions, source: view.source && { ...view.source, evidence: null } }
    }
    if (action.kind === 'recovery') {
      const view = await this.runs(action.command)
      // runs() opened the IdP page on this Mac; approvalLink only returns that verified address for the result.
      const opened = action.command.type === 'openApproval' ? await this.approvalLink(action.command.podId, action.command.runId, action.command.grantId) : null
      return { runs: view.runs.map(({ id, state, scriptHash, startedAt, finishedAt, recovery }) => ({ id, state, scriptHash, startedAt, finishedAt, recovery: recovery?.state ?? null })), effects: view.effects?.map(({ key, runId }) => ({ key, runId })) ?? [], approvals: view.approvals?.map(({ runId, grantId, state }) => ({ runId, grantId, state })) ?? [], ...(opened ? { opened } : {}) }
    }
    let approval: string | null = null
    if (action.kind === 'program') {
      if (['prepare', 'start', 'poll', 'input', 'close'].includes(action.command.type)) return this.program(action.command)
      const definition = action.command.type === 'add' || action.command.type === 'replace'
        ? action.path!.endsWith('.app') ? await applicationDefinition(action.path!) : await this.installedProgram(action.path!, { runtimePath: action.runtimePath })
        : undefined
      if (action.command.type === 'grant') approval = await this.grantProgram(action.command, owner)
      else await this.program(action.command, definition, action.path)
    }
    else if (action.kind === 'importSecret') {
      await importPrivateSecret(action.path, value => this.resources({ type: 'saveCredential', ...action.command, value }))
    }
    else if (action.kind === 'requestSecret') {
      if (!this.secretsGate) throw new Error('OpenApe Secrets is unavailable until the desktop is set up')
      const { epoch } = parseResourceState(await this.dispatch({ resource: { type: 'list', podId: action.command.podId } }))
      if (epoch !== action.command.epoch) throw new Error('Pod or resources changed; reload before requesting a secret')
      const row = await this.secretsGate.request(action.command.podId, action.command.alias, action.command.purpose)
      return { requestId: row.id, status: row.status, expiresAt: row.expiresAt }
    }
    else if (action.command.type === 'assignJev' || action.command.type === 'assignSsh' || action.command.type === 'assignHttp') {
      approval = (await this.assign(action.command, owner)).approval
    }
    else {
      await this.resources(action.command)
    }
    const view = await this.resources({ type: 'list', podId: command.podId })
    // A pending request is approved by the owner at the IdP; Pods has opened that page on this Mac.
    return { resources: modelResources(view.resources, true), grants: (await this.podGrants()!.list({ podId: command.podId })).map(grantView), sandbox: await this.dispatch({ grants: { type: 'sandbox', podId: command.podId } }), variables: view.variables, epoch: view.epoch, ...(approval ? { approval: { state: 'pending', url: approval } } : {}) }
  }

  async master(command: MasterCommand): Promise<MasterView> { const central = this.centralAction(command.type); if (central) return central.local(() => this.master(command)); return parseMasterView(await this.dispatch({ master: command })) }

  async scripts(command: ScriptCommand): Promise<ScriptView> {
    const central = this.centralAction(command.type); if (central) return central.local(() => this.scripts(command))
    const view = parseScriptView(await this.dispatch({ scripts: command }))
    return { ...view, environment: visibleEnvironment(podEnvironmentValues(this.root, command.podId)) }
  }

  async details(command: DetailsCommand): Promise<PodDetails> { const central = this.centralAction(command.type); if (central) return central.local(() => this.details(command)); return parsePodDetails(await this.dispatch({ details: command })) }

  async request(command: WorkspaceCommand): Promise<WorkspaceState> { const central = this.centralAction(command.type); if (central) return central.local(() => this.request(command)); return parseWorkspace(await this.dispatch(command)) }

  private async migrateHttpCredentials(podId?: string): Promise<void> {
    const assignments = await this.dispatch({ httpCredentialInventory: true }) as { id: string, podId: string, alias: string }[]
    for (const assignment of assignments) {
      if (podId && assignment.podId !== podId) continue
      await this.credentials!.migrateHttp(assignment.id, assignment.podId, assignment.alias)
    }
  }

  async resources(command: InternalResourceCommand): Promise<ResourceState> {
    const central = this.centralAction(command.type === 'sandbox' ? 'list' : command.type); if (central) return central.local(() => this.resources(command))
    await this.setupReady
    if (command.type === 'sandbox' || command.type === 'saveSandboxDeny') return this.sandboxState(command.podId, command.type === 'saveSandboxDeny' ? command.deny : undefined)
    if (command.type === 'assignJev' || command.type === 'assignSsh' || command.type === 'assignHttp') return (await this.assign(command, null)).view
    if (command.type === 'saveCredential') {
      if (!this.credentials) throw new Error('Credential store is unavailable')
      const before = parseResourceState(await this.dispatch({ resource: { type: 'list', podId: command.podId } }))
      if (before.epoch !== command.epoch) throw new Error('Pod or resources changed; reload before assigning credentials')
      const id = await this.credentials.createScriptSecret(command.podId, command.alias, command.value)
      let view: ResourceState
      try { view = parseResourceState(await this.dispatch({ resource: { type: 'assignCredential', podId: command.podId, alias: command.alias, credentialId: id, epoch: command.epoch } })) }
      catch (error) {
        const current = parseResourceState(await this.dispatch({ resource: { type: 'list', podId: command.podId } }))
        if (!current.resources.some(item => item.kind === 'credential' && item.state === 'ready' && item.configuration.credentialId === id)) await this.credentials.erasePodKey(id, command.podId)
        throw error
      }
      for (const old of before.resources.filter(item => item.kind === 'credential' && item.configuration.alias === command.alias)) await this.credentials.erasePodKey(old.configuration.credentialId as string, command.podId)
      await this.migrateHttpCredentials(command.podId)
      return view
    }
    const before = command.type === 'revoke' ? parseResourceState(await this.dispatch({ resource: { type: 'list', podId: command.podId } })).resources.find(item => item.id === command.id) : undefined
    const view = parseResourceState(await this.dispatch({ resource: command }))
    if (command.type === 'bindHttp') await this.migrateHttpCredentials(command.podId)
    if (before?.kind === 'credential' || before?.configuration.type === 'program') {
      if (!this.credentials) throw new Error('Credential store is unavailable')
      await this.credentials.erasePodKey((before.configuration.credentialId ?? before.configuration.stateId) as string, command.podId)
    }
    return view
  }

  /**
   * Stores an assignment and requests its grant as the Pod. In an owner session the grant is approved right away;
   * otherwise Pods opens its IdP page, and a run that needs the assignment before then waits for the decision.
   */
  private async assign(command: Extract<InternalResourceCommand, { type: 'assignJev' | 'assignSsh' | 'assignHttp' }>, owner: OwnerSession | null): Promise<{ view: ResourceState, approval: string | null }> {
    await this.setupReady
    if (!this.connections) throw new Error('Connection setup is not ready')
    const before = parseResourceState(await this.dispatch({ resource: { type: 'list', podId: command.podId } }))
    // Jev and SSH keep the grant they were assigned with; it is a recorded Pod grant like any other.
    const authority = async (grantId: string) => { const connection = await this.connections!.podConnection(command.podId); return { identity: connection.identity, ownerConnection: connection.ownerConnection, grantId } }
    if (command.type === 'assignJev') {
      if (before.epoch !== command.epoch) throw new Error('Pod or Jev permissions changed; reload before assigning access')
      if (before.jev?.id !== command.connectionId || before.jev.state !== 'ready') throw new Error('TypeSafe is not connected; reconnect in App settings')
      const { grantId, approval } = await this.provisionGrant(command.podId, httpSpec(typesafeOrigin, ['POST']), owner)
      return { view: parseResourceState(await this.dispatch({ resource: { ...command, type: 'bindJev', authority: await authority(grantId) } })), approval }
    }
    if (command.type === 'assignSsh') {
      if (before.epoch !== command.epoch) throw new Error('Pod or SSH permissions changed; reload before assigning access')
      const binding = await resolveSshTarget(command.target)
      const { grantId, approval } = await this.provisionGrant(command.podId, sshSpec(sshGrantArgv(binding)), owner)
      return { view: parseResourceState(await this.dispatch({ resource: { type: 'bindSsh', podId: command.podId, epoch: command.epoch, binding, authority: await authority(grantId) } })), approval }
    }
    // The sandbox entry and its grant are separate: the destination becomes reachable, and the same origin and
    // methods are requested as a Pod grant.
    if (before.epoch !== command.epoch) throw new Error('Pod or HTTP permissions changed; reload before assigning access')
    const permission = parseHttpPermission(command.permission)
    const view = parseResourceState(await this.dispatch({ resource: { type: 'bindHttp', podId: command.podId, epoch: command.epoch, permission, ...(command.authentication ? { authentication: command.authentication } : {}) } }))
    await this.migrateHttpCredentials(command.podId)
    const { approval } = await this.provisionGrant(command.podId, httpSpec(permission.origin, permission.methods), owner)
    return { view, approval }
  }

  /** Requests a grant as the Pod; in an owner session approves it as continuing, otherwise opens and returns its IdP page. */
  private async provisionGrant(podId: string, spec: GrantSpec, owner: OwnerSession | null): Promise<{ grantId: string, approval: string | null }> {
    const { grant, approval } = await this.podGrants()!.request(podId, spec, AbortSignal.timeout(120000))
    if (!approval) return { grantId: grant.id, approval: null }
    if (owner) { await this.podGrants()!.approve(owner, podId, grant.id, 'always', AbortSignal.timeout(60000)); return { grantId: grant.id, approval: null } }
    await this.host.openExternal(approval)
    return { grantId: grant.id, approval }
  }

  /** The Pod's name as the IdP shows it with the Pod's grant requests. */
  private async podName(podId: string): Promise<string> {
    return grantPodName(parseWorkspace(await this.dispatch({ type: 'list' })).pods.find(pod => pod.id === podId)?.name ?? 'Pod')
  }

  private administration(): Administration {
    return {
      grants: this.podGrants()!,
      resources: podId => this.resources({ type: 'list', podId }),
      podName: podId => this.podName(podId),
      ledger: command => this.dispatch({ grants: command }),
      programDefinition: async entry => entry.path.endsWith('.app') ? applicationDefinition(entry.path) : this.installedProgram(entry.path, { runtimePath: entry.runtimePath }),
      grantCall: command => this.programs!.grantCall(command),
      addProgram: async (podId, definition) => { await this.program({ type: 'add', podId, epoch: (await this.resources({ type: 'list', podId })).epoch }, definition) },
      assignHttp: async (podId, permission) => { await this.dispatch({ resource: { type: 'bindHttp', podId, epoch: (await this.resources({ type: 'list', podId })).epoch, permission } }) },
      assignDirectory: async (podId, path, access) => { await this.resources({ type: 'assignDirectory', podId, path, access, epoch: (await this.resources({ type: 'list', podId })).epoch }) },
      importSecret: async (podId, alias, path) => {
        const { epoch } = await this.resources({ type: 'list', podId })
        await importPrivateSecret(path, value => this.resources({ type: 'saveCredential', podId, alias, value, epoch }))
      },
    }
  }

  async runs(command: RunCommand): Promise<RunView> {
    const central = this.centralAction(command.type); if (central) return central.local(() => this.runs(command))
    await this.setupReady
    if (command.type === 'openGrant') {
      const grants = this.podGrants()
      if (!grants) throw new Error('Connection setup is not ready')
      await this.host.openExternal(await grants.approvalPage(command.podId, command.grantId))
      return parseRunView(await this.dispatch({ run: { type: 'list', podId: command.podId } }))
    }
    if (command.type !== 'openApproval') return parseRunView(await this.dispatch({ run: command }))
    const { view, url } = await this.pendingApproval(command.podId, command.runId, command.grantId)
    await this.host.openExternal(url)
    return view
  }

  /** The IdP address of a waiting runtime approval, verified against the Pod's own identity issuer. */
  async approvalLink(podId: string, runId: string, grantId: string): Promise<string> { return (await this.pendingApproval(podId, runId, grantId)).url }

  private async pendingApproval(podId: string, runId: string, grantId: string): Promise<{ view: RunView, url: string }> {
    await this.setupReady
    const view = parseRunView(await this.dispatch({ run: { type: 'list', podId, runId } }))
    const pending = view.approvals?.find(item => item.runId === runId && item.grantId === grantId)
    if (!pending) throw new Error('This approval is no longer waiting; refresh the run status')
    const connection = await this.connections!.podConnection(podId)
    if (pending.issuer !== (connection.decisionIssuer ?? connection.issuer) || pending.subject !== connection.subject) throw new Error('Approval belongs to a different Pod identity')
    const { runId: _runId, ...approval } = pending
    return { view, url: approvalURL(approval) }
  }

  // Direct reads for the inbox projection: reading never becomes a workspace operation.
  async inboxSources(): Promise<DecisionSources> {
    const [workspace, domain, secrets] = await Promise.all([this.dispatch({ type: 'map' }), this.dispatch({ domain: { type: 'list' } }), this.secretsGate?.view() ?? null])
    return { map: parseWorkspace(workspace).map ?? null, domain: domain as DomainOverview, secrets }
  }

  // Imported Pods are ordinary local Pods: a connected workspace gives each its own identity as soon as the paused copy exists.
  // File dialogs and file writes happen in the application window handler; this method only routes and provisions.
  async sharing(value: SharingCommand): Promise<SharingState> {
    const command = parseSharingCommand(value)
    const central = this.centralAction(['list', 'show', 'inspect', 'inspectSource'].includes(command.type) ? 'list' : command.type)
    if (central) return central.local(() => this.sharing(command))
    const sent: SharingCommand = command.scope === 'import' && command.type === 'bind' ? { ...command, bundle: await this.importedBundle(command) } : command
    const state = await this.dispatch({ sharing: sent }) as SharingState
    if (command.scope === 'import' && command.type === 'commit' && this.central && state.current) {
      const { owner } = await this.remoteOwner()
      // Every created Pod gets its pending-identity record even when an earlier one fails; the copy already exists.
      const results = await Promise.allSettled(state.current.pods.map(pod => this.centralProvision(pod.podId, owner)))
      const failed = results.find(result => result.status === 'rejected')
      if (failed) throw failed.reason
    }
    return state
  }

  // The worker cannot read bundle metadata. Identity and executable hash come from the assigned bundle itself, never from the caller;
  // the worker compares the hash with the assignment it binds and keeps it, so a later change of the assignment reopens setup.
  private async importedBundle(command: Extract<PortableImportCommand, { type: 'bind' }>): Promise<{ identity: string, executableHash: string } | null> {
    const current = (await this.dispatch({ sharing: { scope: 'import', type: 'show', id: command.id } }) as SharingState).current
    const podId = current?.pods.find(item => item.key === command.pod)?.podId
    if (!podId) return null
    const configuration = parseResourceState(await this.dispatch({ resource: { type: 'list', podId } })).resources.find(item => item.id === command.resourceId)?.configuration
    if (typeof configuration?.bundlePath !== 'string') return null
    const bundle = await applicationBundle(configuration.bundlePath)
    return bundle.identity ? { identity: bundle.identity, executableHash: bundle.executableHash } : null
  }

  async definitions(value: DefinitionCommand): Promise<DefinitionsView> {
    const command = parseDefinitionCommand(value)
    const central = this.centralAction(command.type)
    if (central) return central.local(() => this.definitions(command))
    const view = parseDefinitionsView(await this.dispatch({ definitions: command }))
    if ((command.type !== 'instantiate' && command.type !== 'retryProvision') || !view.createdPodId) return view
    const pending = view.provisioning.find(item => item.requestId === command.requestId)
    if (pending?.state === 'ready') return view
    try {
      const { owner } = await this.remoteOwner()
      const identity = await this.provisionRemotePod(view.createdPodId, owner)
      await this.remote({ type: 'claim', podId: view.createdPodId, owner, identity })
      await this.remote({ type: 'provision', podId: view.createdPodId, identity, error: null })
      return { ...parseDefinitionsView(await this.dispatch({ definitionProvision: { requestId: command.requestId, error: null } })), createdPodId: view.createdPodId }
    }
    catch (error) {
      await this.dispatch({ definitionProvision: { requestId: command.requestId, error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) } })
      throw new Error(`Instance ${view.createdPodId} is retained for provisioning retry. ${String(error)}`)
    }
  }

  /** Owner administration of shared domain data; changes run as central local operations like every other owner command. */
  async domain(command: DomainCommand): Promise<unknown> {
    if (command.type === 'openApproval') {
      const overview = await this.dispatch({ domain: { type: 'list' } }) as DomainOverview
      const url = overview.approvals.find(item => item.id === command.id && item.state === 'requested')?.batchUrl
      if (!url || URL.parse(url)?.protocol !== 'https:') throw new Error('No approval is waiting at the IdP for this item')
      await this.host.openExternal(url)
      return overview
    }
    const reading = ['list', 'entries', 'work'].includes(command.type)
    const central = reading ? null : this.centralAction(command.type)
    if (central) return central.local(() => this.domain(command))
    return this.dispatch({ domain: command })
  }

  async scheduling(command: ScheduleCommand): Promise<ScheduleView> { const central = this.centralAction(command.type); if (central) return central.local(() => this.scheduling(command)); return parseScheduleView(await this.dispatch({ schedule: command })) }

  private async centralProvision(podId: string, owner: Owner): Promise<void> {
    const directory = join(this.root, 'central'); const path = join(directory, `pod-${centralId(podId)}.json`)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    try { await writeFile(path, JSON.stringify({ podId, owner }), { mode: 0o600, flag: 'wx', flush: true }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    const pending = JSON.parse(await readFile(path, 'utf8')) as { podId: string, owner: Owner }
    if (pending.podId !== podId || !sameOwner(pending.owner, owner)) throw new Error('Pending Pod provisioning belongs to another owner')
    try {
      const identity = await this.provisionRemotePod(podId, owner)
      await this.remote({ type: 'claim', podId, owner, identity })
      await rm(path)
    }
    catch (error) { throw new Error(`Pod ${podId} exists and is awaiting its identity. Do not create it again. ${String(error)}`) }
  }

  async centralSnapshot(): Promise<CentralSnapshot> {
    const { owner } = await this.remoteOwner()
    await mkdir(join(this.root, 'central'), { recursive: true, mode: 0o700 })
    for (const name of await readdir(join(this.root, 'central'))) {
      const match = /^pod-([a-f0-9-]{36})\.json$/.exec(name)
      if (match) await this.centralProvision(match[1]!, owner)
    }
    await this.indexRemotePods(owner)
    return await this.dispatch({ central: { type: 'snapshot', owner } }) as CentralSnapshot
  }

  async centralGate(until: number): Promise<CentralGate> { return await this.dispatch({ central: { type: 'gate', until } }) as CentralGate }
  async centralVersion(): Promise<number> { return Number(await this.dispatch({ central: { type: 'version' } })) }

  async centralExecute(value: CentralCommand): Promise<unknown> {
    if (value.channel === 'inbox') {
      if (!this.inbox) throw new Error('Inbox decisions are unavailable on this desktop')
      return this.inbox.decide(parseInboxDecide(parseInboxCentralCommand(value).body))
    }
    const parsed = parseCentralCommand(value)
    await this.dispatch({ central: { type: 'assertCommand', command: parsed } })
    const { channel, body } = parsed
    const command = body as never
    if (channel === 'workspace') {
      const before = body.type === 'create' ? parseWorkspace(await this.dispatch({ type: 'list' })).pods.map(pod => pod.id) : []
      const result = await this.request(command)
      const { owner } = await this.remoteOwner()
      if (body.type === 'create') {
        for (const pod of result.pods.filter(pod => !before.includes(pod.id))) {
          await this.centralProvision(pod.id, owner)
        }
        await this.indexRemotePods(owner)
      }
      return result
    }
    if (channel === 'data') return this.data(command)
    if (channel === 'scripts') return this.scripts(command)
    if (channel === 'details') return this.details(command)
    if (channel === 'scheduling') return this.scheduling(command)
    if (channel === 'runs') return this.runs(command)
    if (channel === 'resources') return this.resources(command)
    if (channel === 'sharing') return this.sharing(command)
    throw new Error('Unsupported central execution')
  }

  private dispatch(command: { cliRun: Extract<RunCommand, { type: 'start' }> } | { programExecution: ProgramExecutionCheck } | { approvalRelease: { type: 'list' } | { type: 'released', keys: string[] } } | { definitions: DefinitionCommand } | { sharing: SharingCommand } | { definitionProvision: { requestId: string, error: string | null } } | { domain: DomainCommand } | { central: { type: 'snapshot', owner: Owner } | { type: 'assertCommand', command: CentralCommand } | { type: 'gate', until: number } | { type: 'version' } } | { codexAdministration: AdministrationJournal } | { grants: GrantLedgerCommand } | { codex: CodexRequest, ownerOperation?: boolean } | { remote: RemoteInternal } | { inboxOutbox: InboxOutboxCommand } | { program: ProgramInternal } | { scripts: ScriptCommand } | { data: DataInternal } | { setup: SetupInternal } | { inspectCredentials: true } | { credentialInventory: true } | { httpCredentialInventory: true } | { provider: { port: number, capability: string } | null } | { master: MasterCommand } | { credentialCheck: ServiceCheck & { alias: string } } | { serviceCheck: ServiceCheck } | { runContext: RunContextRequest } | WorkspaceCommand | { details: DetailsCommand } | { secrets: SecretRowCommand } | { resource: InternalResourceCommand } | { run: RunCommand } | { schedule: ScheduleCommand }): Promise<unknown> {
    if (this.updateFrozen && !('data' in command && ['prepareUpdate', 'releaseUpdate'].includes(command.data.type))) return Promise.reject(new Error('Pods is preparing an update; retry after restart'))
    const child = this.child
    if (!child || this.state.state !== 'ready' || this.stopping) return Promise.reject(new Error('Worker is not ready'))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Worker response timed out; reload state before retrying')) }, 'data' in command ? 15 * 60 * 1000 : 'sharing' in command ? 10 * 60 * 1000 : 'central' in command && command.central.type === 'snapshot' ? 60000 : 'codex' in command ? 180000 : 'scripts' in command && ['prepareDependencies', 'validate'].includes(command.scripts.type) ? 20 * 60 * 1000 : ('run' in command && command.run.type === 'recover') || 'inspectCredentials' in command ? 30000 : 10000)
      this.pending.set(id, { resolve, reject, timer }); child.postMessage({ id, command })
    })
  }

  private grantTokens(runId: string): RunGrantTokens {
    for (const [id, tokens] of this.runTokens) {
      if (id !== runId && tokens.expired()) this.runTokens.delete(id)
    }
    const tokens = this.runTokens.get(runId) ?? new RunGrantTokens()
    this.runTokens.set(runId, tokens)
    return tokens
  }

  /** Parks a service call while its run waits for an IdP decision, here and in the worker's bridge. */
  private park(id: string, runId: string, parked: boolean): void {
    if (parked === this.parked.has(id)) return
    if (parked) {
      const ofRun = [...this.parked.values()].filter(run => run === runId).length
      if (ofRun >= parkedPerRun || this.parked.size >= parkedTotal) throw new Error('Waiting for IdP approval: too many calls already wait for the owner\'s decision; retry after it')
      this.parked.set(id, runId)
    }
    else {
      this.parked.delete(id)
    }
    this.child?.postMessage({ serviceParked: { id, parked } })
  }

  private async executeService(request: ServiceRequest): Promise<unknown> {
    if (!request || typeof request.id !== 'string' || !/^[a-f0-9-]{36}$/.test(request.id) || this.services.has(request.id) || this.services.size - this.parked.size >= 16) throw new Error('Invalid or excessive broker request')
    if (request.kind !== undefined && !serviceKinds.includes(request.kind)) throw new Error('Unsupported broker service')
    if (this.host.oneShot && request.kind === 'credential') throw new Error('Assigned script secrets are not supported by ape-pods yet')
    const scope = parseServiceScope(request.scope)
    const controller = new AbortController(); this.services.set(request.id, controller)
    const check = async (domain?: { path: string, ownerPid: number }) => parseResourceState(await this.dispatch({ serviceCheck: { scope, ...(domain ? { domain } : {}) } }))
    try {
      if (request.kind === 'shellClose') {
        this.jevAttempts.delete(scope.runId)
        await this.shellIdentities.get(scope.runId)?.close(); this.shellIdentities.delete(scope.runId); this.runTokens.delete(scope.runId); return true
      }
      const context = parseRunContext(await this.dispatch({ runContext: { scope } }))
      if (request.kind === 'scriptGrant') {
        const start = this.cliStarts.get(scope.podId)
        if (!start) return true
        this.cliStarts.delete(scope.podId)
        try {
          if (start.runId !== scope.runId || !start.owner.active) throw new Error('The owner start belongs to another run or has ended')
          const call = request.body as ProgramCall
          const artifact = join(this.root, 'runs', 'script-artifacts', `${start.scriptHash}.mjs`)
          const entry = join(this.directory, 'runtime/script-entry.mjs')
          if (call.argv?.[0] !== entry || call.argv[1] !== '--input-channel' || call.argv[2] !== artifact || call.argv[4] !== start.scriptHash || call.argv.length !== 5 || !call.files?.some(file => file.path === artifact && file.sha256 === start.scriptHash)) throw new Error('Owner start does not match the selected script invocation')
          const executableHash = createHash('sha256').update(await readFile(process.execPath)).digest('hex')
          const entryHash = createHash('sha256').update(await readFile(entry)).digest('hex')
          if (call.program.name !== basename(process.execPath) || call.program.sha256 !== executableHash || call.files.length !== 2 || !call.files.some(file => file.path === entry && file.sha256 === entryHash)) throw new Error('Owner start runtime or entry code changed')
          const grants = this.podGrants()
          if (!grants) throw new Error('Pod grant authority is unavailable')
          const { grantId, approval } = await grants.requestProgram(scope.podId, { ...call, grantType: 'once' }, controller.signal)
          if (approval) await grants.approve(start.owner, scope.podId, grantId, 'once', controller.signal)
          await check()
          return true
        }
        finally { await start.owner.close() }
      }
      // The Pod's name and, for a script call, its own summary; the IdP shows them when the call needs a new grant (issue 1473).
      const presentation: GrantPresentation = { origin: grantPodName(context.name), ...(request.summary === undefined ? {} : { summary: parseScriptSummary(request.summary) }) }
      // Every grant this Pod requests or observes is recorded; a later call or run reuses it by coverage.
      const ledger = this.podGrants()?.port(scope.podId)
      const observe = async (observed: RunApproval) => {
        // An approval made in the owner's MCP session is shown as such in the run activity.
        const approval = observed.state === 'approved' && (await this.podGrants()?.list({ podId: scope.podId }))?.some(grant => grant.id === observed.grantId && grant.approvedInSession) ? { ...observed, approvedInSession: true } : observed
        // Parking first enforces its limits before the wait is recorded.
        if (approval.state === 'pending') this.park(request.id, scope.runId, true)
        await this.dispatch({ serviceCheck: { scope, approval } })
        if (approval.state !== 'pending') this.park(request.id, scope.runId, false)
        if (approval.state !== 'pending' || context.reason !== 'manual' || this.openedApprovals.has(approval.grantId)) return
        this.openedApprovals.add(approval.grantId)
        try { await this.host.openExternal(approvalURL(approval)) }
        catch { await this.dispatch({ serviceCheck: { scope, approval: { ...approval, openError: 'The browser could not be opened; use Open approval to try again' } } }) }
      }
      if (request.kind === 'shell') {
        await check()
        if (!this.connections || this.shellIdentities.has(scope.runId)) throw new Error('Pod execution identity is unavailable or already in use')
        const dist = this.directory
        const runtime = { executable: process.execPath, cli: this.host.apesCli, client: join(dist, 'runtime/shell-client.mjs') }
        const environment = await podEnvironment(this.root, scope.podId, runtime)
        const connection = await this.connections.podConnection(scope.podId)
        const identity = await podIdentityFile(this.root, connection)
        try { await check(); controller.signal.throwIfAborted() }
        catch (error) { await identity.close(); throw error }
        this.shellIdentities.set(scope.runId, { refresh: async (signal) => { signal.throwIfAborted(); identity.assertActive() }, close: identity.close })
        const reach = this.host.oneShot ? await this.sandboxReach(scope.podId) : undefined
        const start = this.cliStarts.get(scope.podId)
        if (start) {
          if (start.runId && start.runId !== scope.runId) throw new Error('The owner start already belongs to another run')
          start.runId = scope.runId
        }
        const home = programHome(reach, environment.home)
        return {
          home,
          ...(reach ? { reach } : {}),
          environment: { ...environment.environment, HOME: home },
          machine: {
            runtime: { executable: runtime.executable, cli: runtime.cli, environment: { APES_AUTH_FILE: identity.path, APES_IGNORE_USER_CONFIG: '1' } },
            targetHost: connection.targetHost,
            issuer: connection.decisionIssuer ?? connection.issuer,
            ...(start ? { grantType: 'once' as const } : {}),
            summary: grantSummary('Execute the selected Pod script', grantPodName(context.name)),
            waitMs: 7 * 24 * 60 * 60 * 1000,
          },
        }
      }
      // The worker lease and assigned identity remain required; ape-shell alone authorizes program execution.
      const runtime = this.shellIdentities.get(scope.runId)
      if (!runtime) throw new AuthorityError('Pod execution authority is not active for this run')
      try { await runtime.refresh(controller.signal) }
      catch (error) {
        if (error instanceof InfrastructureError) throw error
        await this.dispatch({ serviceCheck: { scope, authorityLost: true } })
        throw error instanceof AuthorityError ? error : new AuthorityError('Pod execution permission is no longer active; review the Pod permissions before retrying')
      }
      const tokens = this.grantTokens(scope.runId)
      if (request.kind === 'credential') {
        const alias = parseCredentialRead(request.body)
        if (!this.credentials) throw new Error('Credential store is unavailable')
        const id = await this.dispatch({ credentialCheck: { scope, alias } })
        if (typeof id !== 'string') throw new Error('Invalid credential broker binding')
        controller.signal.throwIfAborted()
        const value = await this.credentials.readScriptSecret(id, scope.podId, alias)
        const current = await this.dispatch({ credentialCheck: { scope, alias } })
        controller.signal.throwIfAborted()
        if (current !== id) throw new Error('Credential changed during access')
        return value
      }
      const state = await check()
      if (request.kind === 'jev') {
        if (!this.credentials || !this.connections) throw new Error('Connection service unavailable')
        const assignment = assignedJev(state.resources, scope.podId, scope.capabilities)
        const result = await executeJev(assignment, parseJevRequest(request.body), {
          credentials: this.credentials,
          signal: controller.signal,
          observe,
          ledger,
          check,
          tokens,
          presentation,
          send: (body, signal) => this.connections!.typesafeRequest(assignment.connectionId, body, signal),
          consumeAttempt: () => {
            const count = this.jevAttempts.get(scope.runId) ?? 0
            if (count >= assignment.maxAttempts) throw new Error('Jev request limit reached for this run')
            this.jevAttempts.set(scope.runId, count + 1)
          },
        })
        await check(); controller.signal.throwIfAborted(); return result
      }
      if (request.kind === 'http') {
        if (!this.credentials || !this.connections) throw new Error('Credential store is unavailable')
        const credentials = this.credentials
        const bearer: AgentBearer = {
          token: async (authentication, origin) => {
            const id = await this.dispatch({ credentialCheck: { scope, alias: authentication.credential } })
            if (typeof id !== 'string') throw new Error('Invalid credential broker binding')
            return this.agentTokens.destination(scope.podId, authentication, origin, id, () => credentials.readHttpSecret(id, scope.podId, authentication.credential, controller.signal), controller.signal)
          },
          reject: authentication => this.agentTokens.reject(scope.podId, authentication),
        }
        const result = await executeHttp(state.resources, scope, parseHttpRequest(request.body), await this.connections.podConnection(scope.podId), controller.signal, observe, ledger, bearer, tokens, presentation)
        await check(); controller.signal.throwIfAborted(); return result
      }
      if (request.kind === undefined && request.body && typeof request.body === 'object' && 'sshInventory' in request.body) {
        if (!this.credentials) throw new Error('Credential store is unavailable')
        const dist = this.directory
        return await invokeSsh({ resources: state.resources, scope, body: request.body, dist, root: join(this.root, 'runs', scope.runId), credentials: this.credentials, signal: controller.signal, check, observe, ledger, tokens, presentation })
      }
      if (request.kind === undefined && request.body && typeof request.body === 'object' && ('applicationId' in request.body || 'application' in request.body)) {
        if (!this.credentials || !this.connections) throw new Error('Credential store is unavailable')
        const dist = this.directory
        const body = request.body
        const requested = programRequest(state.resources, scope.podId, scope.capabilities, body)
        const connection = await this.connections.podConnection(scope.podId)
        const workspace = await podWorkspace(this.root, scope.podId)
        const directories = directoryPolicy(await assignedDirectories(this.root, scope.podId, state.resources))
        const reach = await this.sandboxReach(scope.podId)
        const lease = { ...directories, workspace, capabilities: scope.capabilities, signal: controller.signal, assertCurrent: () => controller.signal.throwIfAborted(), registerDomain: async (path: string, ownerPid: number) => { await check({ path, ownerPid }); controller.signal.throwIfAborted() } }
        const title = grantSummary(requested.assignment.cliId, presentation.origin, presentation.summary)
        const issuer = connection.decisionIssuer ?? connection.issuer
        const result = await executeRecordedProgram(body, executionObserver => invokeProgram(state.resources, scope.podId, body, join(dist, 'native/pods-helper'), join(this.root, 'runs', scope.runId), this.credentials!, lease, {
          connection,
          reach,
          execution: {
            operationId: request.id,
            targetHost: connection.targetHost,
            summary: title,
            runtime: { executable: process.execPath, cli: this.host.apesCli },
            observer: { ...executionObserver, authorized: async (value) => { await executionObserver.authorized(value); await observe({ grantId: value.grantId, issuer, title: title.title, state: 'approved' }) } },
          },
        }), async (record) => { await this.dispatch({ programExecution: { scope, operationId: request.id, record } }) }, async (grantId) => { await observe({ grantId, issuer, title: title.title, state: 'pending' }) })
        await check(); controller.signal.throwIfAborted(); return result
      }
      throw new Error('Unsupported service request')
    }
    finally { controller.abort(); this.services.delete(request.id); this.parked.delete(request.id) }
  }

  lifecycle(event: 'suspend' | 'resume'): void { if (this.state.state === 'ready' && !this.stopping) this.child?.postMessage(event) }

  /** Ends a worker that is still trying to open storage; recovery copies and restores need it stopped. */
  async stopForRecovery(): Promise<void> {
    if (this.state.state !== 'recovery') throw new Error('Storage is not in recovery')
    const child = this.child
    if (child) await new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.kill() })
  }

  /** Opens storage again after the owner fixed or restored it; automation starts only if it becomes ready. */
  async retryStorage(): Promise<void> {
    await this.stopForRecovery()
    this.start(this.root, this.profileBase)
  }

  async stop(): Promise<void> {
    await this.setupReady
    await this.programs?.stop()
    await this.closeShellIdentities()
    await this.secretsGate?.stop()
    await this.connections?.stop()
    this.providerAbort.abort()
    await this.providerGateway?.close()
    this.stopping = true
    const child = this.child
    if (!child) return
    await new Promise<void>((resolve) => {
      const deadline = setTimeout(() => child.kill(), 10000)
      child.once('exit', () => { clearTimeout(deadline); resolve() })
      child.postMessage('stop')
    })
  }
}
