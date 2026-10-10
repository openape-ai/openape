import type { InboxOutboxCommand } from '../worker/inbox/outbox'
import type { DecisionSources, InboxDecisions } from './inbox/decisions'
import { parseInboxDecide } from '../contracts/inbox'
import { readOnlyAction } from './codex/routing'
import { boundedCodexNetworkResult, codexNetworkRead, parseCodexNetworkAction } from '../contracts/codex-networks'
import { applicationBundle, applicationDefinition } from './programs/application'
import { parseSharingCommand } from '../contracts/sharing'
import type { PortableImportCommand, SharingCommand, SharingState } from '../contracts/sharing'
import { parseCentralNetworkRead } from '../contracts/central-networks'
import { parseDefinitionCommand, parseDefinitionsView } from '../contracts/definitions'
import type { DefinitionCommand, DefinitionsView } from '../contracts/definitions'
import type { NetworkGateManifest } from '../contracts/network-gates'
import { parseNetworkGateReleases } from '../contracts/network-gates'
import { resolveSshTarget, sshGrantArgv } from './ssh/configuration'
import { invokeSsh } from './ssh/invoke'
import { AuthorityError, InfrastructureError, NonRetryableError, retryInfrastructure } from '../contracts/infrastructure'
import type { InfrastructureFailure } from '../contracts/infrastructure'
import { MailArchiveService } from './mail/archive/service'
import { ArchiveStore } from './mail/archive/store'
import { handleMailArchive } from './mail/archive/handler'
import { handleGate, releaseNetworkGrants } from './gates/handler'
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
import { programDefinition } from './programs/definition'
import { modelResources } from '../worker/master/resources'
import { sameOwner } from '@openape/pods-protocol'
import type { RemoteInternal } from '../worker/remote/registration'
import type { Owner } from '@openape/pods-protocol'
import { parseWorkflowView } from '../contracts/workflows'
import { parseNetworkCommand, parseNetworkView } from '../contracts/networks'
import type { NetworkCommand, NetworkView } from '../contracts/networks'
import type { WorkflowCommand, WorkflowView } from '../contracts/workflows'
import type { ServiceScope, RunContextRequest, ServiceCheck, ServiceRequest  } from '../contracts/services'
import { loadAdapter, resolveCommand } from '@openape/apes'
import { approvalURL } from '../contracts/activity'
import type { RunApproval } from '../contracts/activity'
import { assignedDirectories, directoryPolicy } from '../runtime/directories'
import { podEnvironment, podEnvironmentValues, visibleEnvironment } from '../runtime/environment'
import { podWorkspace } from './programs/console'
import { invokeProgram, programRequest } from './programs/invoke'
import { administerGrants, administerSandbox, releaseArchivedNetworkGrants } from './grants/administration'
import type { Administration } from './grants/administration'
import { archiveRefusal, assertArchiveMove } from '../contracts/network-capabilities'
import { ProgramManager } from './programs/manager'
import { PodGrants, commandSpec, httpSpec } from './grants/pod-grants'
import { runtimeArgv } from './grants/execution-context'
import type { GrantSpec } from './grants/pod-grants'
import type { OwnerSession } from './connections/owner-session'
import { apesLogin } from './connections/apes-login'
import type { ApesLogin } from './connections/apes-login'
import type { GrantLedgerCommand } from '../worker/resources/grants'
import type { SandboxReach, SandboxView } from '../contracts/sandbox'
import { deniedPaths, ownerProtectedPaths } from '../worker/runtime/sandbox'
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
import { parseRunContext, parseServiceScope, runAuthorityWatchMs } from '../contracts/services'
import type { CredentialCache } from './connections/cache'
import { createMacOSCredentialCache } from './connections/macos'
import { PodIdentityManager } from './connections/agent'
import { AgentAuthority, RunGrantTokens } from './broker/authorization'
import { setTimeout as delay } from 'node:timers/promises'
import { MailService } from './mail/service'
import { assignedMail } from './mail/assigned'
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
import { app, shell, utilityProcess } from 'electron'
import type { UtilityProcess } from 'electron'
import { dirname, join } from 'node:path'
import type { WorkerStatus } from '../contracts/ipc'

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

export class FixtureWorker {
  central: CentralController | null = null
  inbox: InboxDecisions | null = null
  private apesLogin: ApesLogin | null = null
  // The runtime grant is checked at run start, watched at a low frequency, and re-verified before each service call.
  private shellIdentities = new Map<string, { refresh: (signal: AbortSignal) => Promise<void>, close: () => Promise<void> }>()
  private runTokens = new Map<string, RunGrantTokens>()
  private openedApprovals = new Set<string>()
  private archiveService?: MailArchiveService
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
  private child: UtilityProcess | null = null
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
    return ['list', 'graph', 'gateOpen'].includes(type) ? null : this.central
  }

  constructor(private readonly publish: (status: WorkerStatus) => void) {}
  start(root: string, profileBase: string): void {
    try { assertPilotRuntime() }
    catch (error) { this.state = { state: 'error', pid: null, error: error instanceof Error ? error.message : 'Unsupported Mac' }; this.publish(this.state); return }
    this.root = realpathSync(root)
    this.profileBase = profileBase
    this.credentials = createMacOSCredentialCache(join(this.root, 'credentials'))
    const fixturePort = process.env.NODE_ENV === 'test' ? process.env.OPENAPE_PODS_FIXTURE_MODEL_PORT : undefined
    if (fixturePort && (!/^\d+$/.test(fixturePort) || Number(fixturePort) < 1024 || Number(fixturePort) > 65535)) throw new Error('Invalid synthetic model port')
    // Synthetic fixtures freeze gate batches at once instead of collecting inputs for two minutes.
    const fixtureGates = process.env.NODE_ENV === 'test' && !!process.env.OPENAPE_PODS_FIXTURE_DIR
    this.child = utilityProcess.fork(join(__dirname, '../worker/entry.cjs'), [], { cwd: root, env: { HOME: root, TMPDIR: root, PATH: '/usr/bin:/bin', PODS_RUNTIME_EXECUTABLE: process.execPath, ...(process.env.OPENAPE_PODS_CENTRAL_ENABLED === '1' ? { PODS_CENTRAL_ENABLED: '1' } : {}), ...(fixturePort ? { PODS_FIXTURE_MODEL_PORT: fixturePort } : {}), ...(fixtureGates ? { PODS_FIXTURE_GATE_COLLECT: '0' } : {}) }, serviceName: 'OpenApe Pods Fixture Worker', stdio: 'pipe' })
    const child = this.child
    const reportError = (error: string) => { this.state = { state: 'error', pid: child.pid ?? null, error }; this.publish(this.state) }
    child.on('message', (message: unknown) => {
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
      this.state = { state: 'ready', pid: child.pid ?? null, error: null }
      this.setupReady = (async () => { await this.initializeConnections(); this.publish(this.state) })().catch((error: unknown) => { reportError(error instanceof Error ? error.message : 'Connection setup failed') })
    })
    child.on('exit', (code) => {
      this.programs?.cancelAll()
      void this.closeShellIdentities().catch((error: unknown) => { console.error('Pod shell credential cleanup failed', error) })
      for (const service of this.services.values()) service.abort(new Error('Owning worker stopped'))
      this.state = this.stopping ? { state: 'stopped', pid: null, error: null } : { state: 'error', pid: null, error: `Worker exited (${code}). Quit and reopen Pods to recover.` }
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Worker stopped before replying')) }
      this.pending.clear()
      this.child = null; this.publish(this.state)
    })
    child.stderr?.on('data', (data: Buffer) => { console.error('[pods worker]', data.toString()) })
  }

  private async initializeConnections(): Promise<void> {
    const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
    const runtime = { helper: join(dist, 'native/pods-helper'), executable: process.execPath, entry: join(dist, 'runtime/script-entry.mjs'), runtimeDirectories: [dirname(dirname(process.execPath))], environment: { ELECTRON_RUN_AS_NODE: '1' }, binary: join(dist, 'vendor/codex'), catalog: join(dist, 'vendor/models.json'), manifest: join(dist, 'vendor/manifest.json'), sdkHost: join(dist, 'runtime/sdk-host.mjs') }
    this.connections = new ConnectionManager(this.root, runtime, this.credentials!, command => this.dispatch({ setup: command }), async () => {
      const ready = await this.connections!.providerReady()
      await this.dispatch({ provider: ready && this.providerGateway ? { port: this.providerGateway.port, capability: this.providerGateway.capability } : null })
    }, !!process.env.OPENAPE_PODS_FIXTURE_DIR && process.env.NODE_ENV === 'test')
    this.providerGateway = await startAgentGateway({ provider: (body, signal) => this.connections!.provider(body, signal), tool: async () => { throw new Error('Model credential gateway has no tools') } }, this.providerAbort.signal)
    const connections = this.connections
    const grants = this.podGrants()!
    this.programs = new ProgramManager(join(this.root, 'authentication'), runtime.helper, this.credentials!, this.connections, podId => this.resources({ type: 'list', podId }), command => this.dispatch({ program: command }), grants, podId => ({ connection: () => connections.podConnection(podId), ledger: grants.port(podId), reach: () => this.sandboxReach(podId) }))
    await this.connections.initialize(async () => { await this.dispatch({ inspectCredentials: true }); await this.credentials!.reconcileScriptSecrets(await this.dispatch({ credentialInventory: true }) as { id: string, podId: string }[]); await this.finishDeletions() })
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
    const identities = [...this.shellIdentities.values()]; this.shellIdentities.clear(); this.runTokens.clear(); this.jevAttempts.clear()
    await Promise.all(identities.map(identity => identity.close()))
  }

  async program(command: ProgramCommand, definition?: ProgramDefinition, file?: string): Promise<Awaited<ReturnType<ProgramManager['terminal']>> | Awaited<ReturnType<ProgramManager['prepare']>> | ResourceState | string | null> {
    const central = this.centralAction(['launchStatus', 'prepare', 'poll', 'input', 'close'].includes(command.type) ? 'list' : command.type)
    if (central) return central.local(() => this.program(command, definition, file))
    await this.setupReady
    if (!this.programs) throw new Error('Program service is not ready')
    if (command.type === 'launchStatus') return this.programs.launchStatus(command.podId)
    if (command.type === 'openFolder') throw new Error('The Pod folder opens from the owner window')
    if (command.type === 'openShell') {
      const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
      return this.programs.openShell(command.podId, { executable: process.execPath, cli: app.isPackaged ? join(process.resourcesPath, 'apes/ape-shell.mjs') : join(dist, 'vendor/apes/ape-shell.mjs'), client: join(dist, 'runtime/shell-client.mjs') })
    }
    if (command.type === 'launch') {
      const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
      return this.programs.launch(command, { executable: process.execPath, cli: app.isPackaged ? join(process.resourcesPath, 'apes/ape-shell.mjs') : join(dist, 'vendor/apes/ape-shell.mjs'), client: join(dist, 'runtime/shell-client.mjs') })
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

  /** Requests the command grant as the Pod; in an owner session it is approved right away, otherwise the IdP page opens. */
  private async grantProgram(command: Extract<ProgramCommand, { type: 'grant' }>, owner: OwnerSession | null): Promise<string | null> {
    await this.setupReady
    if (!this.programs || !this.podGrants()) throw new Error('Program service is not ready')
    return (await this.provisionGrant(command.podId, await this.programs.grantSpec(command), owner)).approval
  }

  /** The Pod grants of the connected owner; null until the connection service is set up. */
  private podGrants(): PodGrants | null {
    const connections = this.connections
    if (!connections) return null
    this.grants ??= new PodGrants({ connection: podId => connections.podConnection(podId), ledger: command => this.dispatch({ grants: command }) })
    return this.grants
  }

  /**
   * The effective sandbox reach of a Pod: its own level and, for a network member, the network's (the more permissive
   * wins), with the denylists of both.
   */
  async sandboxReach(podId: string): Promise<SandboxReach> {
    const view = await this.dispatch({ grants: { type: 'sandbox', podId } }) as SandboxView
    return { level: view.level, protectedPaths: [...ownerProtectedPaths(this.root, this.profileBase, homedir()), ...controlSocketProtection(this.profileBase)], deny: deniedPaths(view.deny, homedir()) }
  }

  /** The Pod's resources with its sandbox; a saved denylist replaces the Pod's own entries, never a network's. */
  private async sandboxState(podId: string, deny?: string[]): Promise<ResourceState> {
    if (deny) await this.dispatch({ grants: { type: 'deny', podId, source: 'pod', revision: null, deny } })
    const [state, sandbox] = await Promise.all([this.dispatch({ resource: { type: 'list', podId } }), this.dispatch({ grants: { type: 'sandbox', podId } })])
    return { ...parseResourceState(state), sandbox: sandbox as SandboxView }
  }

  async onboarding(command: OnboardingCommand): Promise<OnboardingView> {
    await this.setupReady
    if (!this.connections) throw new Error('Connection setup is not ready')
    return this.connections.execute(command)
  }

  inboxOutbox(command: InboxOutboxCommand): Promise<unknown> { return this.dispatch({ inboxOutbox: command }) }

  /** Revokes always grants of finished network approval batches at the IdP; a failure is logged and retried later with backoff. */
  async releaseNetworkGrants(signal: AbortSignal): Promise<void> {
    if (!this.connections) return
    const grants = this.podGrants()
    if (grants) {
      try { await releaseArchivedNetworkGrants({ grants, ledger: command => this.dispatch({ grants: command }), revokeResource: async (podId, id, revision) => { await this.resources({ type: 'revoke', podId, id, revision }) }, resources: podId => this.resources({ type: 'list', podId }) }, signal) }
      catch (error) { console.error('Could not release the grants and sandbox of an archived network', error) }
    }
    for (const release of parseNetworkGateReleases(await this.dispatch({ networkGateRelease: { type: 'list' } }))) {
      const retry = this.releaseRetry.get(release.taskId)
      if (retry && retry.at > Date.now()) continue
      try {
        await releaseNetworkGrants(release, this.connections, signal)
        await this.dispatch({ networkGateRelease: { type: 'released', taskId: release.taskId } })
        this.releaseRetry.delete(release.taskId)
      }
      catch (error) {
        const failures = (retry?.failures ?? 0) + 1
        this.releaseRetry.set(release.taskId, { at: Date.now() + Math.min(60 * 60000, 60000 * 2 ** failures), failures })
        console.error(`Could not release the approval grants of network gate batch ${release.taskId}`, error)
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
    const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
    // The bundled apes CLI renews an expired key login under its own lock; Pods only reads the login.
    this.apesLogin ??= apesLogin({ executable: process.execPath, script: app.isPackaged ? join(process.resourcesPath, 'apes/ape-shell.mjs') : join(dist, 'vendor/apes/ape-shell.mjs') })
    return this.connections.apesOwnerSession(endsAt, signal, this.apesLogin)
  }

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

  async codex(request: CodexRequest, owner: OwnerSession | null = null): Promise<unknown> {
    if (request.action.action === 'workspace') {
      const query = parseWorkspaceAction(request.action)
      if (!this.central) throw new Error('Connect the central workspace in the desktop app first')
      if (query.type === 'reconcile') return this.central.reconcile(query.id as string, query.applied as boolean, query.evidence as string)
      return this.central.query(query)
    }
    if (request.action.action === 'runtime') return { ...await this.dispatch({ codex: request }) as object, workspace: workspaceHelp, ...(this.central ? { central: this.central.status() } : {}) }
    const reading = readOnlyAction(request.action)
    if (request.action.action === 'networks') {
      const command = parseCodexNetworkAction(request.action)
      // Opens the approval page in the owner's browser like the desktop button; the owner decides there.
      if (command.type === 'gateOpen') return boundedCodexNetworkResult(command, await this.networks(command))
      if (!codexNetworkRead(command) && this.central && !this.central.networkReads) throw new Error('Network actions require bounded relay publication support')
    }
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
        ? action.path!.endsWith('.app') ? await applicationDefinition(action.path!, join(this.root, 'applications')) : await programDefinition(action.path!, action.adapterPath, action.commandName, action.runtimePath)
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
      return view
    }
    const before = command.type === 'revoke' ? parseResourceState(await this.dispatch({ resource: { type: 'list', podId: command.podId } })).resources.find(item => item.id === command.id) : undefined
    const view = parseResourceState(await this.dispatch({ resource: command }))
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
    const vendor = join(__dirname, '../vendor').replace('/app.asar/', '/app.asar.unpacked/')
    // Jev and SSH keep the grant they were assigned with; it is a recorded Pod grant like any other.
    const authority = async (grantId: string) => { const connection = await this.connections!.podConnection(command.podId); return { identity: connection.identity, ownerConnection: connection.ownerConnection, grantId } }
    if (command.type === 'assignJev') {
      if (before.epoch !== command.epoch) throw new Error('Pod or Jev permissions changed; reload before assigning access')
      if (before.jev?.id !== command.connectionId || before.jev.state !== 'ready') throw new Error('TypeSafe is not connected; reconnect in App settings')
      const { grantId, approval } = await this.provisionGrant(command.podId, await httpSpec(join(vendor, 'pod-http-shapes.toml'), typesafeOrigin, ['POST']), owner)
      return { view: parseResourceState(await this.dispatch({ resource: { ...command, type: 'bindJev', authority: await authority(grantId) } })), approval }
    }
    if (command.type === 'assignSsh') {
      if (before.epoch !== command.epoch) throw new Error('Pod or SSH permissions changed; reload before assigning access')
      const binding = await resolveSshTarget(command.target)
      const { grantId, approval } = await this.provisionGrant(command.podId, await commandSpec(loadAdapter('pod-ssh', join(vendor, 'pod-ssh-shapes.toml')), sshGrantArgv(binding)), owner)
      return { view: parseResourceState(await this.dispatch({ resource: { type: 'bindSsh', podId: command.podId, epoch: command.epoch, binding, authority: await authority(grantId) } })), approval }
    }
    // The sandbox entry and its grant are separate: the destination becomes reachable, and the same origin and
    // methods are requested as a Pod grant.
    if (before.epoch !== command.epoch) throw new Error('Pod or HTTP permissions changed; reload before assigning access')
    const permission = parseHttpPermission(command.permission)
    const view = parseResourceState(await this.dispatch({ resource: { type: 'bindHttp', podId: command.podId, epoch: command.epoch, permission, ...(command.authentication ? { authentication: command.authentication } : {}) } }))
    const { approval } = await this.provisionGrant(command.podId, await httpSpec(join(vendor, 'pod-http-shapes.toml'), permission.origin, permission.methods), owner)
    return { view, approval }
  }

  /** Requests a grant as the Pod; in an owner session approves it as continuing, otherwise opens and returns its IdP page. */
  private async provisionGrant(podId: string, spec: GrantSpec, owner: OwnerSession | null): Promise<{ grantId: string, approval: string | null }> {
    const { grant, approval } = await this.podGrants()!.request(podId, spec, null, AbortSignal.timeout(120000))
    if (!approval) return { grantId: grant.id, approval: null }
    if (owner) { await this.podGrants()!.approve(owner, podId, grant.id, 'always', AbortSignal.timeout(60000)); return { grantId: grant.id, approval: null } }
    await shell.openExternal(approval)
    return { grantId: grant.id, approval }
  }

  private administration(): Administration {
    return {
      grants: this.podGrants()!,
      vendor: join(__dirname, '../vendor').replace('/app.asar/', '/app.asar.unpacked/'),
      resources: podId => this.resources({ type: 'list', podId }),
      podName: async podId => grantPodName(parseWorkspace(await this.dispatch({ type: 'list' })).pods.find(pod => pod.id === podId)?.name ?? 'Pod'),
      networks: () => this.networks({ type: 'list' }),
      ledger: command => this.dispatch({ grants: command }),
      programDefinition: async entry => entry.path.endsWith('.app') ? applicationDefinition(entry.path, join(this.root, 'applications')) : programDefinition(entry.path, entry.adapterPath, entry.commandName, entry.runtimePath),
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
    if (command.type !== 'openApproval') return parseRunView(await this.dispatch({ run: command }))
    const { view, url } = await this.pendingApproval(command.podId, command.runId, command.grantId)
    await shell.openExternal(url)
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
    const [workspace, networks, workflows, secrets] = await Promise.all([this.dispatch({ type: 'map' }), this.dispatch({ networks: { type: 'list' } }), this.dispatch({ workflow: { type: 'list' } }), this.secretsGate?.view() ?? null])
    return { map: parseWorkspace(workspace).map ?? null, networks: parseNetworkView(networks), workflows: parseWorkflowView(workflows), secrets }
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

  async networks(command: NetworkCommand): Promise<NetworkView> {
    const parsed = parseNetworkCommand(command)
    if (this.central && !this.central.networkReads && !['list', 'detail', 'trace', 'records', 'archivePreview', 'legacyItems', 'conversionPreview', 'replacementSetup', 'replacementPreview'].includes(parsed.type)) throw new Error('Network actions require bounded relay publication support')
    const central = this.centralAction(['detail', 'setup', 'trace', 'records', 'archivePreview', 'legacyItems', 'conversionPreview', 'replacementSetup', 'replacementPreview'].includes(parsed.type) ? 'list' : parsed.type)
    if (central) return central.local(() => this.networks(parsed))
    const view = parseNetworkView(await this.dispatch({ networks: parsed, ownerOperation: this.central?.executing === true }))
    if (parsed.type === 'gateOpen') {
      const url = view.gates?.find(gate => gate.networkId === parsed.id && gate.id === parsed.taskId && gate.generation === parsed.generation && gate.state === 'pending')?.url
      if (!url || new URL(url).protocol !== 'https:') throw new Error('No approval is waiting for this batch')
      await shell.openExternal(url)
    }
    return view
  }

  async workflows(command: WorkflowCommand): Promise<WorkflowView> {
    if (command.type === 'gateOpen') {
      const view = parseWorkflowView(await this.dispatch({ workflow: { type: 'list' } }))
      const url = view.gates?.batches.find(batch => batch.id === command.batchId && batch.state === 'pending')?.url
      // The address was built by the app from the issuer of the Pod identity, never from item data.
      if (!url || new URL(url).protocol !== 'https:') throw new Error('No approval is waiting for this batch')
      await shell.openExternal(url)
      return view
    }
    const central = this.centralAction(command.type); if (central) return central.local(() => this.workflows(command)); return parseWorkflowView(await this.dispatch({ workflow: command }))
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

  async centralSnapshot(networkReads = false): Promise<CentralSnapshot> {
    const { owner } = await this.remoteOwner()
    await mkdir(join(this.root, 'central'), { recursive: true, mode: 0o700 })
    for (const name of await readdir(join(this.root, 'central'))) {
      const match = /^pod-([a-f0-9-]{36})\.json$/.exec(name)
      if (match) await this.centralProvision(match[1]!, owner)
    }
    await this.indexRemotePods(owner)
    return await this.dispatch({ central: { type: 'snapshot', owner, networkReads } }) as CentralSnapshot
  }

  async centralNetworkRead(command: unknown): Promise<NetworkView> {
    const { owner } = await this.remoteOwner()
    return parseNetworkView(await this.dispatch({ central: { type: 'networkRead', owner, command: parseCentralNetworkRead(command) } }))
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

  private dispatch(command: { definitions: DefinitionCommand } | { networkGateRelease: { type: 'list' } | { type: 'released', taskId: string } } | { sharing: SharingCommand } | { definitionProvision: { requestId: string, error: string | null } } | { networkGateCheck: { scope: ServiceScope, manifest: NetworkGateManifest, operation: string, grants?: { key: string, id: string }[] } } | { networks: NetworkCommand, ownerOperation?: boolean } | { central: { type: 'snapshot', owner: Owner, networkReads?: boolean } | { type: 'networkRead', owner: Owner, command: NetworkCommand } | { type: 'assertCommand', command: CentralCommand } | { type: 'gate', until: number } | { type: 'version' } } | { codexAdministration: AdministrationJournal } | { grants: GrantLedgerCommand } | { codex: CodexRequest, ownerOperation?: boolean } | { remote: RemoteInternal } | { inboxOutbox: InboxOutboxCommand } | { workflow: WorkflowCommand } | { program: ProgramInternal } | { scripts: ScriptCommand } | { data: DataInternal } | { setup: SetupInternal } | { inspectCredentials: true } | { credentialInventory: true } | { provider: { port: number, capability: string } | null } | { master: MasterCommand } | { credentialCheck: ServiceCheck & { alias: string } } | { serviceCheck: ServiceCheck } | { runContext: RunContextRequest } | WorkspaceCommand | { details: DetailsCommand } | { secrets: SecretRowCommand } | { resource: InternalResourceCommand } | { run: RunCommand } | { schedule: ScheduleCommand }): Promise<unknown> {
    if (this.updateFrozen && !('data' in command && ['prepareUpdate', 'releaseUpdate'].includes(command.data.type))) return Promise.reject(new Error('Pods is preparing an update; retry after restart'))
    const child = this.child
    if (!child || this.state.state !== 'ready' || this.stopping) return Promise.reject(new Error('Worker is not ready'))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Worker response timed out; reload state before retrying')) }, 'data' in command ? 15 * 60 * 1000 : 'sharing' in command ? 10 * 60 * 1000 : 'central' in command && command.central.type === 'snapshot' ? 60000 : 'codex' in command ? 180000 : 'scripts' in command && command.scripts.type === 'prepareDependencies' ? 210000 : ('run' in command && command.run.type === 'recover') || ('networks' in command && ['inspect', 'retry', 'reconcileEffect', 'resolveConflict', 'discardFailure'].includes(command.networks.type)) || 'inspectCredentials' in command ? 30000 : 10000)
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
    if (request.kind !== undefined && request.kind !== 'gate' && request.kind !== 'mailArchive' && request.kind !== 'mailMove' && request.kind !== 'credential' && request.kind !== 'jev' && request.kind !== 'http' && request.kind !== 'shell' && request.kind !== 'shellClose') throw new Error('Unsupported broker service')
    const scope = parseServiceScope(request.scope)
    const controller = new AbortController(); this.services.set(request.id, controller)
    const check = async (domain?: { path: string, ownerPid: number }) => parseResourceState(await this.dispatch({ serviceCheck: { scope, ...(domain ? { domain } : {}) } }))
    try {
      if (request.kind === 'shellClose') {
        this.jevAttempts.delete(scope.runId)
        await this.shellIdentities.get(scope.runId)?.close(); this.shellIdentities.delete(scope.runId); this.runTokens.delete(scope.runId); return true
      }
      const context = parseRunContext(await this.dispatch({ runContext: { scope } }))
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
        try { await shell.openExternal(approvalURL(approval)) }
        catch { await this.dispatch({ serviceCheck: { scope, approval: { ...approval, openError: 'The browser could not be opened; use Open approval to try again' } } }) }
      }
      if (request.kind === 'shell') {
        await check()
        if (!this.connections || !context.runtime || this.shellIdentities.has(scope.runId)) throw new Error('Pod execution authority is unavailable or already in use')
        // A run starts with no reused tokens, so the runtime grant, owner, identity and key are checked at the IdP.
        const tokens = new RunGrantTokens(); this.runTokens.set(scope.runId, tokens)
        const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
        const runtime = { executable: process.execPath, cli: app.isPackaged ? join(process.resourcesPath, 'apes/ape-shell.mjs') : join(dist, 'vendor/apes/ape-shell.mjs'), client: join(dist, 'runtime/shell-client.mjs') }
        const environment = await podEnvironment(this.root, scope.podId, runtime)
        const connection = await this.connections.podConnection(scope.podId)
        const authority = new AgentAuthority(connection, observe, ledger, tokens)
        const adapterPath = join(dist, 'vendor/pod-runtime-shapes.toml')
        const adapter = loadAdapter('pod-runtime', adapterPath)
        const name = grantPodName(context.name)
        const argv = runtimeArgv({ podId: scope.podId, name, script: join(this.root, 'runs', scope.runId, 'run.mjs'), workspace: environment.workspace, home: environment.home, environment: visibleEnvironment(environment.environment) })
        const resolved = await resolveCommand(adapter, argv)
        const assignment = { grantId: '', command: { cliId: 'pod-runtime', adapterPath, adapterDigest: adapter.digest, argv, coverage: [resolved.detail] } }
        await authority.authorize(assignment, controller.signal, `Pod: ${name} (${scope.podId})\nRun the stored script inside this Pod's managed runtime. Script changes remain within separately assigned permissions. This approval does not enable a schedule.\nScript: ${join(this.root, 'runs', scope.runId, 'run.mjs')}\nWorkspace: ${environment.workspace}\nHOME: ${environment.home}`)
        await check(); controller.signal.throwIfAborted()
        const monitoring = new AbortController()
        const monitor = (async () => {
          try { while (!monitoring.signal.aborted) { await delay(runAuthorityWatchMs, undefined, { signal: monitoring.signal }); await retryInfrastructure(() => authority.assertActive(assignment.grantId, monitoring.signal), monitoring.signal, async (retry) => { if (!monitoring.signal.aborted) await this.dispatch({ serviceCheck: { scope, infrastructure: retry } }) }) } }
          catch (error) {
            if (!monitoring.signal.aborted) {
              console.error('Pod execution authority lost', error)
              try { await this.dispatch({ serviceCheck: { scope, authorityLost: true } }) }
              catch (cancelError) { console.error('Could not cancel the revoked Pod run', cancelError) }
            }
          }
        })()
        this.shellIdentities.set(scope.runId, { refresh: signal => authority.refresh(assignment, signal), close: async () => { monitoring.abort(); await monitor } })
        return { home: environment.home, environment: environment.environment }
      }
      // Every other service needs the run's active runtime authority; network and decision-maintenance runs execute no runtime.
      const runtime = this.shellIdentities.get(scope.runId)
      if (context.runtime && !runtime) throw new AuthorityError('Pod execution authority is not active for this run')
      if (runtime) {
        try { await runtime.refresh(controller.signal) }
        catch (error) {
          if (error instanceof InfrastructureError) throw error
          await this.dispatch({ serviceCheck: { scope, authorityLost: true } })
          throw error instanceof AuthorityError ? error : new AuthorityError('Pod execution permission is no longer active; review the Pod permissions before retrying')
        }
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
      if (request.kind === 'gate') {
        if (!this.connections) throw new Error('Connection service unavailable')
        const result = await handleGate({ body: request.body, scope, connections: this.connections, check, checkGate: async (manifest, operation, grants) => this.dispatch({ networkGateCheck: { scope, manifest, operation, grants } }), signal: controller.signal })
        await check(); controller.signal.throwIfAborted(); return result
      }
      if (request.kind === 'mailArchive') {
        if (!this.credentials || !this.connections) throw new Error('Connection service unavailable')
        this.archiveService ??= new MailArchiveService(new ArchiveStore(join(this.root, 'mail-archive')))
        const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
        const result = await handleMailArchive({ service: this.archiveService, body: request.body, scope, root: this.root, helper: join(dist, 'native/pods-helper'), credentials: this.credentials, connections: this.connections, check, signal: controller.signal, observe, ledger, reach: () => this.sandboxReach(scope.podId) })
        await check(); controller.signal.throwIfAborted(); return result
      }
      if (request.kind === 'jev') {
        if (!this.credentials || !this.connections) throw new Error('Connection service unavailable')
        const assignment = assignedJev(state.resources, scope.podId, scope.capabilities)
        const vendor = join(__dirname, '../vendor').replace('/app.asar/', '/app.asar.unpacked/')
        const result = await executeJev(assignment, parseJevRequest(request.body), {
          vendor, credentials: this.credentials, signal: controller.signal, observe, ledger, check, tokens,
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
        const vendor = join(__dirname, '../vendor').replace('/app.asar/', '/app.asar.unpacked/')
        const credentials = this.credentials
        const bearer: AgentBearer = {
          token: async (authentication) => {
            const id = await this.dispatch({ credentialCheck: { scope, alias: authentication.credential } })
            if (typeof id !== 'string') throw new Error('Invalid credential broker binding')
            return this.agentTokens.bearer(scope.podId, authentication, id, () => credentials.readScriptSecret(id, scope.podId, authentication.credential), controller.signal)
          },
          reject: authentication => this.agentTokens.reject(scope.podId, authentication),
        }
        const result = await executeHttp(state.resources, scope, parseHttpRequest(request.body), vendor, await this.connections.podConnection(scope.podId), controller.signal, observe, ledger, bearer, tokens)
        await check(); controller.signal.throwIfAborted(); return result
      }
      if (request.kind === undefined && request.body && typeof request.body === 'object' && 'sshInventory' in request.body) {
        if (!this.credentials) throw new Error('Credential store is unavailable')
        const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
        return await invokeSsh({ resources: state.resources, scope, body: request.body, dist, root: join(this.root, 'runs', scope.runId), credentials: this.credentials, signal: controller.signal, check, observe, ledger, tokens })
      }
      if (request.kind === 'mailMove' || (request.body && typeof request.body === 'object' && ('applicationId' in request.body || 'application' in request.body))) {
        if (!this.credentials || !this.connections) throw new Error('Credential store is unavailable')
        const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
        const notStarted = (error: unknown) => request.kind === 'mailMove' ? archiveRefusal(error) : error
        let requested: ReturnType<typeof programRequest>
        try {
          requested = programRequest(state.resources, scope.podId, scope.capabilities, request.body)
          if (request.kind === 'mailMove') assertArchiveMove(requested.argv)
        }
        catch (error) { throw notStarted(error) }
        const connection = await this.connections.podConnection(scope.podId).catch((error: unknown) => { throw notStarted(error) })
        const workspace = await podWorkspace(this.root, scope.podId)
        const directories = directoryPolicy(await assignedDirectories(this.root, scope.podId, state.resources))
        const result = await invokeProgram(state.resources, scope.podId, request.body, join(dist, 'native/pods-helper'), join(this.root, 'runs', scope.runId), this.credentials, { ...directories, workspace, capabilities: scope.capabilities, signal: controller.signal, assertCurrent: () => controller.signal.throwIfAborted(), registerDomain: async (path, ownerPid) => { await check({ path, ownerPid }); controller.signal.throwIfAborted() } }, { connection, ledger, reach: await this.sandboxReach(scope.podId), observe, tokens }, request.kind === 'mailMove' ? 'move' : undefined)
        await check(); controller.signal.throwIfAborted(); return result
      }
      const assignment = assignedMail(state.resources)
      if (assignment.identity.podId !== scope.podId) throw new Error('Agent identity belongs to another pod')
      const credentials = this.credentials
      if (!credentials) throw new Error('Credential store is unavailable')
      const identity = new PodIdentityManager(credentials)
      const authority = new AgentAuthority(identity.connection(assignment.identity, `pods:${scope.podId}`), observe, ledger, tokens)
      const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
      const service = new MailService(join(dist, 'native/pods-helper'), join(dist, 'vendor'), authority, credentials)
      const value = await service.execute(assignment.mail, request.body, join(this.root, 'runs', scope.runId), { capabilities: scope.capabilities, assertCurrent: () => controller.signal.throwIfAborted(), signal: controller.signal, registerDomain: async (path, ownerPid) => { await check({ path, ownerPid }); controller.signal.throwIfAborted() } })
      await check(); controller.signal.throwIfAborted()
      return value
    }
    finally { controller.abort(); this.services.delete(request.id); this.parked.delete(request.id) }
  }

  lifecycle(event: 'suspend' | 'resume'): void { if (this.state.state === 'ready' && !this.stopping) this.child?.postMessage(event) }

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
