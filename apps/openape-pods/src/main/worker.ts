import { applicationBundle, applicationDefinition } from './programs/application'
import { parsePortableImportCommand } from '../contracts/sharing'
import type { PortableImportCommand, PortableImportState } from '../contracts/sharing'
import { parseCentralNetworkRead } from '../contracts/central-networks'
import { parseDefinitionCommand, parseDefinitionsView } from '../contracts/definitions'
import type { DefinitionCommand, DefinitionsView } from '../contracts/definitions'
import type { NetworkGateManifest } from '../contracts/network-gates'
import { resolveSshTarget, sshGrantArgv } from './ssh/configuration'
import { invokeSsh } from './ssh/invoke'
import { InfrastructureError, retryInfrastructure } from '../contracts/infrastructure'
import type { InfrastructureFailure } from '../contracts/infrastructure'
import { MailArchiveService } from './mail/archive/service'
import { ArchiveStore } from './mail/archive/store'
import { handleMailArchive } from './mail/archive/handler'
import { handleGate } from './gates/handler'
import type { RuntimeApprovalPolicy } from './codex/runtime-approval'
import { assignedJev, parseJevRequest, typesafeOrigin } from '../contracts/jev'
import { executeJev } from './connections/jev-service'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import type { CentralController, CentralGate } from './central/controller'
import type { CentralCommand, CentralSnapshot } from '../contracts/central'
import { centralId, parseCentralCommand } from '../contracts/central'
import { administrationActions, parseAdministration } from '../contracts/codex-admin'
import type { AdministrationJournal, AdministrationReceipt } from '../contracts/codex-admin'
import { importPrivateSecret } from './codex/secret-import'
import { programDefinition } from './programs/definition'
import { modelResources } from '../worker/master/resources'
import { object as remoteObject, uuid as remoteUuid, sameOwner } from '@openape/pods-protocol'
import { ProgramState } from './programs/state'
import type { RemoteInternal } from '../worker/remote/control'
import type { Owner } from '@openape/pods-protocol'
import { parseChatsView } from '../contracts/chats'
import type { ChatsCommand, ChatsView } from '../contracts/chats'
import { parseWorkflowView } from '../contracts/workflows'
import { parseNetworkCommand, parseNetworkView } from '../contracts/networks'
import type { NetworkCommand, NetworkView } from '../contracts/networks'
import type { WorkflowCommand, WorkflowView } from '../contracts/workflows'
import type { ServiceScope, RunContextRequest, ServiceCheck, ServiceRequest  } from '../contracts/services'
import { loadAdapter, resolveCommand } from '@openape/apes'
import { setTimeout as delay } from 'node:timers/promises'
import { approvalURL } from '../contracts/activity'
import type { RunApproval } from '../contracts/activity'
import { assignedDirectories, directoryPolicy } from '../runtime/directories'
import { podEnvironment, podEnvironmentValues, visibleEnvironment } from '../runtime/environment'
import { podWorkspace } from './programs/console'
import { invokeProgram, programRequest } from './programs/invoke'
import { ProgramManager } from './programs/manager'
import type { ProgramDefinition, ProgramCommand } from '../contracts/programs'
import type { ProgramInternal } from '../worker/resources/programs'
import { parseHttpPermission, parseHttpRequest } from '../contracts/http'
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
import { parseWorkspaceAction, workspaceHelp } from '../contracts/codex'
import type { CodexRequest } from '../contracts/codex'
import type { MasterCommand, MasterView } from '../contracts/master'
import { realpathSync } from 'node:fs'
import { parseServiceScope } from '../contracts/services'
import type { CredentialCache } from './connections/cache'
import { createMacOSCredentialCache } from './connections/macos'
import { PodIdentityManager } from './connections/agent'
import { AgentAuthority } from './broker/authorization'
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
import { randomUUID } from 'node:crypto'
import { parseWorkspace } from '../contracts/control'
import type { WorkspaceCommand, WorkspaceState } from '../contracts/control'
import { app, shell, utilityProcess } from 'electron'
import type { UtilityProcess } from 'electron'
import { dirname, join } from 'node:path'
import type { WorkerStatus } from '../contracts/ipc'

export class FixtureWorker {
  central: CentralController | null = null
  private shellIdentities = new Map<string, { close: () => Promise<void> }>()
  private openedApprovals = new Set<string>()
  private archiveService?: MailArchiveService
  private programs: ProgramManager | null = null
  private connections: ConnectionManager | null = null
  private providerGateway: Awaited<ReturnType<typeof startAgentGateway>> | null = null
  private providerAbort = new AbortController()
  private jevAttempts = new Map<string, number>()
  private setupReady: Promise<void> | null = null
  private child: UtilityProcess | null = null
  private stopping = false
  private root = ''
  private credentials: CredentialCache | null = null
  private readonly agentTokens = new DdisaAgentTokens()
  private services = new Map<string, AbortController>()
  private pending = new Map<string, { resolve: (state: unknown) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout> }>()
  private state: WorkerStatus = { state: 'starting', pid: null, error: null }
  private centralAction(type: string): CentralController | null {
    if (!this.central || this.central.executing) return null
    if (!this.central.available) throw new Error(this.central.offlineMessage())
    return ['list', 'graph', 'gateOpen'].includes(type) ? null : this.central
  }

  constructor(private readonly publish: (status: WorkerStatus) => void, private readonly runtimeApproval: RuntimeApprovalPolicy | null = null) {}
  start(root: string): void {
    try { assertPilotRuntime() }
    catch (error) { this.state = { state: 'error', pid: null, error: error instanceof Error ? error.message : 'Unsupported Mac' }; this.publish(this.state); return }
    this.root = realpathSync(root)
    this.credentials = createMacOSCredentialCache(join(this.root, 'credentials'))
    const fixturePort = process.env.NODE_ENV === 'test' ? process.env.OPENAPE_PODS_FIXTURE_MODEL_PORT : undefined
    if (fixturePort && (!/^\d+$/.test(fixturePort) || Number(fixturePort) < 1024 || Number(fixturePort) > 65535)) throw new Error('Invalid synthetic model port')
    this.child = utilityProcess.fork(join(__dirname, '../worker/entry.cjs'), [], { cwd: root, env: { HOME: root, TMPDIR: root, PATH: '/usr/bin:/bin', PODS_RUNTIME_EXECUTABLE: process.execPath, ...(process.env.OPENAPE_PODS_CENTRAL_ENABLED === '1' ? { PODS_CENTRAL_ENABLED: '1' } : {}), ...(fixturePort ? { PODS_FIXTURE_MODEL_PORT: fixturePort } : {}) }, serviceName: 'OpenApe Pods Fixture Worker', stdio: 'pipe' })
    const child = this.child
    const reportError = (error: string) => { this.state = { state: 'error', pid: child.pid ?? null, error }; this.publish(this.state) }
    child.on('message', (message: unknown) => {
      if (message && typeof message === 'object' && 'programCancel' in message) { this.programs?.cancelPod(String(message.programCancel)); return }
      if (message && typeof message === 'object' && 'serviceCancel' in message) { this.services.get(String(message.serviceCancel))?.abort(new Error('Pod tool call cancelled')); return }
      if (message && typeof message === 'object' && 'remoteProgramState' in message) {
        const respond = async () => {
          const request = remoteObject(message.remoteProgramState, ['id', 'operation', 'podId', 'applicationId', 'stateId'])
          const id = remoteUuid(request.id)
          let reply: { id: string, value?: unknown, error?: string }
          try {
            if (!this.credentials) throw new Error('Connection service unavailable')
            const podId = remoteUuid(request.podId)
            if (request.operation === 'create') {
              reply = { id, value: await new ProgramState(this.credentials).create({ podId, applicationId: remoteUuid(request.applicationId) }) }
            }
            else if (request.operation === 'discard') { await this.credentials.erasePodKey(remoteUuid(request.stateId), podId); reply = { id, value: true } }
            else {
              throw new Error('Unsupported broker service')
            }
          }
          catch (error) { reply = { id, error: error instanceof Error ? error.message : 'Connection service unavailable' } }
          if (this.child === child) child.postMessage({ serviceReply: reply })
        }
        void respond().catch((error: unknown) => { console.error('Remote program state failed', error); child.kill() })
        return
      }
      if (message && typeof message === 'object' && 'service' in message) {
        const request = message.service as ServiceRequest
        const respond = async () => {
          let reply: { id: string, value?: unknown, error?: string, infrastructure?: InfrastructureFailure }
          try { reply = { id: request.id, value: await this.executeService(request) } }
          catch (error) { reply = { id: request.id, error: error instanceof Error ? error.message : 'Mail broker failed', ...(error instanceof InfrastructureError && ['http', 'shell', 'tool'].includes(request.kind ?? 'tool') ? { infrastructure: error.failure } : {}) } }
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
    this.programs = new ProgramManager(join(this.root, 'authentication'), runtime.helper, this.credentials!, this.connections, podId => this.resources({ type: 'list', podId }), command => this.dispatch({ program: command }))
    await this.connections.initialize(async () => { await this.dispatch({ inspectCredentials: true }); await this.credentials!.reconcileScriptSecrets(await this.dispatch({ credentialInventory: true }) as { id: string, podId: string }[]); await this.finishDeletions() })
  }

  private async finishDeletions(): Promise<void> {
    const jobs = await this.dispatch({ data: { type: 'jobs' } }) as DeletionJob[]
    for (const job of jobs) { await this.connections!.purgePodKeys(job.podId, job.keyIds); await this.dispatch({ data: { type: 'finishDeletion', podId: job.podId } }) }
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
    const identities = [...this.shellIdentities.values()]; this.shellIdentities.clear(); this.jevAttempts.clear()
    await Promise.all(identities.map(identity => identity.close()))
  }

  async program(command: ProgramCommand, definition?: ProgramDefinition, file?: string): Promise<Awaited<ReturnType<ProgramManager['terminal']>> | Awaited<ReturnType<ProgramManager['prepare']>> | ResourceState | string | null> {
    const central = this.centralAction(['launchStatus', 'prepare', 'poll', 'input', 'resize', 'close'].includes(command.type) ? 'list' : command.type)
    if (central) return central.local(() => this.program(command, definition, file))
    await this.setupReady
    if (!this.programs) throw new Error('Program service is not ready')
    if (command.type === 'launchStatus') return this.programs.launchStatus(command.podId)
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
      await this.programs.grant(command)
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

  async programPreview(command: Extract<ProgramCommand, { type: 'grant' | 'start' }>) {
    await this.setupReady
    if (!this.programs) throw new Error('Program service is not ready')
    return this.programs.preview(command.podId, command.applicationId, command.epoch, command.argv)
  }

  async onboarding(command: OnboardingCommand): Promise<OnboardingView> {
    await this.setupReady
    if (!this.connections) throw new Error('Connection setup is not ready')
    return this.connections.execute(command)
  }

  async remote(command: RemoteInternal): Promise<unknown> { if (this.central && command.type === 'execute') throw new Error('Use the central workspace to control this Pod'); return this.dispatch({ remote: command }) }
  async remoteOwner(): Promise<{ owner: Owner, email: string }> {
    await this.setupReady
    if (!this.connections) throw new Error('Connection service unavailable')
    return this.connections.remoteOwner()
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

  async codex(request: CodexRequest): Promise<unknown> {
    if (request.action.action === 'workspace') {
      const query = parseWorkspaceAction(request.action)
      if (!this.central) throw new Error('Connect the central workspace in the desktop app first')
      if (this.runtimeApproval && query.type === 'submit' && query.runtimeId === this.central.status().runtimeId) {
        const command = parseCentralCommand(query.command)
        if (command.channel === 'workspace' && command.body.type === 'create') this.runtimeApproval.recordCreation(centralId(query.id), centralId(query.runtimeId), command)
      }
      return this.central.query(query)
    }
    if (request.action.action === 'runtime') return { ...await this.dispatch({ codex: request }) as object, workspace: workspaceHelp, ...(this.central ? { central: this.central.status() } : {}) }
    if (this.central && !this.central.executing) return this.central.local(() => this.codex(request))
    if (!administrationActions.includes(String(request.action.action))) {
      const result = await this.dispatch({ codex: request })
      if (request.action.action === 'create') {
        const podId = centralId((result as { id: string }).id)
        this.runtimeApproval?.recordPod(podId)
        if (this.central) await this.centralProvision(podId, (await this.remoteOwner()).owner)
      }
      return result
    }
    const action = parseAdministration(request.action)
    const receipt = await this.dispatch({ codexAdministration: { type: 'begin', request } }) as AdministrationReceipt
    if (receipt.completed) return receipt.result
    try {
      const result = await this.administer(action)
      await this.dispatch({ codexAdministration: { type: 'complete', request, result } })
      return result
    }
    catch (error) {
      await this.dispatch({ codexAdministration: { type: 'failed', request } })
      if (action.kind === 'importSecret' || action.kind === 'importJev') throw new Error('Secret import failed; inspect the private file, current Pod revision and resource epoch before retrying')
      throw error
    }
  }

  private async administer(action: ReturnType<typeof parseAdministration>): Promise<unknown> {
    const { command } = action
    if (action.kind === 'importJev') {
      const before = await this.resources({ type: 'list', podId: command.podId })
      if (before.epoch !== action.command.epoch) throw new Error('Pod permissions changed; reload before importing Jev')
      if (before.jev) throw new Error('A Jev connection already exists; replace it through App settings')
      await importPrivateSecret(action.path, key => this.onboarding({ type: 'saveTypesafe', key }))
      return { jev: (await this.resources({ type: 'list', podId: command.podId })).jev }
    }
    if (action.kind === 'description') return { description: (await this.details(action.command)).description }
    if (action.kind === 'setup') { await this.master(action.command); return { status: 'applied' } }
    if (action.kind === 'scripts') {
      const view = await this.scripts(action.command)
      return { pod: view.pod, resourceEpoch: view.resourceEpoch, credentialAliases: view.credentialAliases, drafts: view.drafts, versions: view.versions, source: view.source && { ...view.source, evidence: null } }
    }
    if (action.kind === 'recovery') {
      const view = await this.runs(action.command)
      return { runs: view.runs.map(({ id, state, scriptHash, startedAt, finishedAt, recovery }) => ({ id, state, scriptHash, startedAt, finishedAt, recovery: recovery?.state ?? null })), effects: view.effects?.map(({ key, runId }) => ({ key, runId })) ?? [] }
    }
    if (action.kind === 'program') {
      if (action.command.type === 'prepare') return this.program(action.command)
      const definition = action.command.type === 'add' || action.command.type === 'replace'
        ? action.path!.endsWith('.app') ? await applicationDefinition(action.path!, join(this.root, 'applications')) : await programDefinition(action.path!, action.adapterPath, action.commandName, action.runtimePath)
        : undefined
      await this.program(action.command, definition, action.path)
    }
    else if (action.kind === 'importSecret') {
      await importPrivateSecret(action.path, value => this.resources({ type: 'saveCredential', ...action.command, value }))
    }
    else {
      await this.resources(action.command)
    }
    const view = await this.resources({ type: 'list', podId: command.podId })
    return { resources: modelResources(view.resources, true), variables: view.variables, epoch: view.epoch }
  }

  async chats(command: ChatsCommand): Promise<ChatsView> { const central = this.centralAction(command.type); if (central) return central.local(() => this.chats(command)); return parseChatsView(await this.dispatch({ chats: command })) }
  async master(command: MasterCommand): Promise<MasterView> { const central = this.centralAction(command.type); if (central) return central.local(() => this.master(command)); return parseMasterView(await this.dispatch({ master: command })) }

  async scripts(command: ScriptCommand): Promise<ScriptView> {
    const central = this.centralAction(command.type); if (central) return central.local(() => this.scripts(command))
    const view = parseScriptView(await this.dispatch({ scripts: command }))
    return { ...view, environment: visibleEnvironment(podEnvironmentValues(this.root, command.podId)) }
  }

  async details(command: DetailsCommand): Promise<PodDetails> { const central = this.centralAction(command.type); if (central) return central.local(() => this.details(command)); return parsePodDetails(await this.dispatch({ details: command })) }

  async request(command: WorkspaceCommand): Promise<WorkspaceState> { const central = this.centralAction(command.type); if (central) return central.local(() => this.request(command)); return parseWorkspace(await this.dispatch(command)) }

  async resources(command: InternalResourceCommand): Promise<ResourceState> {
    const central = this.centralAction(command.type); if (central) return central.local(() => this.resources(command))
    await this.setupReady
    if (command.type === 'assignJev') {
      if (!this.connections) throw new Error('Connection setup is not ready')
      const before = parseResourceState(await this.dispatch({ resource: { type: 'list', podId: command.podId } }))
      if (before.epoch !== command.epoch) throw new Error('Pod or Jev permissions changed; reload before assigning access')
      if (before.jev?.id !== command.connectionId || before.jev.state !== 'ready') throw new Error('TypeSafe is not connected; reconnect in App settings')
      const vendor = join(__dirname, '../vendor').replace('/app.asar/', '/app.asar.unpacked/')
      const authority = await this.connections.approve(command.podId, join(vendor, 'pod-http-shapes.toml'), [['pod-http', 'request', '--origin', typesafeOrigin, '--method', 'POST']])
      return parseResourceState(await this.dispatch({ resource: { ...command, type: 'approveJev', authority } }))
    }
    if (command.type === 'assignSsh') {
      if (!this.connections) throw new Error('Connection setup is not ready')
      const before = parseResourceState(await this.dispatch({ resource: { type: 'list', podId: command.podId } }))
      if (before.epoch !== command.epoch) throw new Error('Pod or SSH permissions changed; reload before assigning access')
      const binding = await resolveSshTarget(command.target)
      const vendor = join(__dirname, '../vendor').replace('/app.asar/', '/app.asar.unpacked/')
      const authority = await this.connections.approve(command.podId, join(vendor, 'pod-ssh-shapes.toml'), [sshGrantArgv(binding)])
      return parseResourceState(await this.dispatch({ resource: { type: 'approveSsh', podId: command.podId, epoch: command.epoch, binding, authority } }))
    }
    if (command.type === 'assignHttp') {
      if (!this.connections) throw new Error('Connection setup is not ready')
      const before = parseResourceState(await this.dispatch({ resource: { type: 'list', podId: command.podId } }))
      if (before.epoch !== command.epoch) throw new Error('Pod or HTTP permissions changed; reload before assigning access')
      const permission = parseHttpPermission(command.permission)
      const current = before.resources.filter(item => item.kind === 'tool' && item.state === 'ready')
      if (!current.some(item => item.configuration.type === 'http' && item.configuration.origin === permission.origin) && current.length >= 16) throw new Error('This pod already has 16 tools')
      const vendor = join(__dirname, '../vendor').replace('/app.asar/', '/app.asar.unpacked/')
      const authority = await this.connections.approve(command.podId, join(vendor, 'pod-http-shapes.toml'), permission.methods.map(method => ['pod-http', 'request', '--origin', permission.origin, '--method', method]))
      return parseResourceState(await this.dispatch({ resource: { type: 'approveHttp', podId: command.podId, epoch: command.epoch, permission, authority, ...(command.authentication ? { authentication: command.authentication } : {}) } }))
    }
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

  async runs(command: RunCommand): Promise<RunView> {
    const central = this.centralAction(command.type); if (central) return central.local(() => this.runs(command))
    await this.setupReady
    if (command.type !== 'openApproval') return parseRunView(await this.dispatch({ run: command }))
    const view = parseRunView(await this.dispatch({ run: { type: 'list', podId: command.podId, runId: command.runId } }))
    const pending = view.approvals?.find(item => item.runId === command.runId && item.grantId === command.grantId)
    if (!pending) throw new Error('This approval is no longer waiting; refresh the run status')
    const connection = await this.connections!.podConnection(command.podId)
    if (pending.issuer !== (connection.decisionIssuer ?? connection.issuer) || pending.subject !== connection.subject) throw new Error('Approval belongs to a different Pod identity')
    const { runId: _runId, ...approval } = pending
    await shell.openExternal(approvalURL(approval))
    return view
  }

  // Imported Pods are ordinary local Pods: a connected workspace gives each its own identity as soon as the paused copy exists.
  async portableImport(value: PortableImportCommand): Promise<PortableImportState> {
    const command = parsePortableImportCommand(value)
    const central = this.centralAction(['list', 'show', 'inspect'].includes(command.type) ? 'list' : command.type)
    if (central) return central.local(() => this.portableImport(command))
    const state = await this.dispatch({ portableImport: command.type === 'bind' ? { ...command, bundle: await this.importedBundle(command) } : command }) as PortableImportState
    if (command.type === 'commit' && this.central && state.current) {
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
    const current = (await this.dispatch({ portableImport: { type: 'show', id: command.id } }) as PortableImportState).current
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

  async centralExecute(value: CentralCommand, operationId?: string): Promise<unknown> {
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
          if (this.runtimeApproval?.createdLocally(operationId, this.central?.status().runtimeId ?? null, parsed)) this.runtimeApproval.recordPod(pod.id)
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
    throw new Error('Unsupported central execution')
  }

  private dispatch(command: { definitions: DefinitionCommand } | { portableImport: PortableImportCommand } | { definitionProvision: { requestId: string, error: string | null } } | { networkGateCheck: { scope: ServiceScope, manifest: NetworkGateManifest, operation: string, grantId?: string } } | { networks: NetworkCommand, ownerOperation?: boolean } | { central: { type: 'snapshot', owner: Owner, networkReads?: boolean } | { type: 'networkRead', owner: Owner, command: NetworkCommand } | { type: 'assertCommand', command: CentralCommand } | { type: 'gate', until: number } | { type: 'version' } } | { codexAdministration: AdministrationJournal } | { codex: CodexRequest } | { remote: RemoteInternal } | { chats: ChatsCommand } | { workflow: WorkflowCommand } | { program: ProgramInternal } | { scripts: ScriptCommand } | { data: DataInternal } | { setup: SetupInternal } | { inspectCredentials: true } | { credentialInventory: true } | { provider: { port: number, capability: string } | null } | { master: MasterCommand } | { credentialCheck: ServiceCheck & { alias: string } } | { serviceCheck: ServiceCheck } | { runContext: RunContextRequest } | WorkspaceCommand | { details: DetailsCommand } | { resource: InternalResourceCommand } | { run: RunCommand } | { schedule: ScheduleCommand }): Promise<unknown> {
    const child = this.child
    if (!child || this.state.state !== 'ready' || this.stopping) return Promise.reject(new Error('Worker is not ready'))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Worker response timed out; reload state before retrying')) }, 'data' in command ? 15 * 60 * 1000 : 'central' in command && command.central.type === 'snapshot' ? 60000 : 'codex' in command ? 180000 : 'scripts' in command && command.scripts.type === 'prepareDependencies' ? 210000 : ('run' in command && command.run.type === 'recover') || ('networks' in command && ['inspect', 'retry', 'reconcileEffect', 'resolveConflict', 'discardFailure'].includes(command.networks.type)) || 'inspectCredentials' in command ? 30000 : 10000)
      this.pending.set(id, { resolve, reject, timer }); child.postMessage({ id, command })
    })
  }

  private async executeService(request: ServiceRequest): Promise<unknown> {
    if (!request || typeof request.id !== 'string' || !/^[a-f0-9-]{36}$/.test(request.id) || this.services.has(request.id) || this.services.size >= 16) throw new Error('Invalid or excessive broker request')
    if (request.kind !== undefined && request.kind !== 'gate' && request.kind !== 'mailArchive' && request.kind !== 'credential' && request.kind !== 'jev' && request.kind !== 'http' && request.kind !== 'shell' && request.kind !== 'shellClose') throw new Error('Unsupported broker service')
    const scope = parseServiceScope(request.scope)
    const controller = new AbortController(); this.services.set(request.id, controller)
    const check = async (domain?: { path: string, ownerPid: number }) => parseResourceState(await this.dispatch({ serviceCheck: { scope, ...(domain ? { domain } : {}) } }))
    try {
      if (request.kind === 'shellClose') {
        this.jevAttempts.delete(scope.runId)
        await this.shellIdentities.get(scope.runId)?.close(); this.shellIdentities.delete(scope.runId); return true
      }
      const context = await this.dispatch({ runContext: { scope } }) as { name: string, reason: string }
      const previous = async (permission: string, connection: { issuer: string, decisionIssuer?: string, subject: string }) => {
        const grant = await this.dispatch({ runContext: { scope, grant: { permission, issuer: connection.decisionIssuer ?? connection.issuer, subject: connection.subject } } }) as RunApproval | null
        return grant && !['cancelled', 'expired'].includes(grant.state) ? grant.grantId : undefined
      }
      const observe = async (approval: RunApproval, automatic = false) => {
        await this.dispatch({ serviceCheck: { scope, approval } })
        if (automatic || approval.state !== 'pending' || context.reason !== 'manual' || this.openedApprovals.has(approval.grantId)) return
        this.openedApprovals.add(approval.grantId)
        try { await shell.openExternal(approvalURL(approval)) }
        catch { await this.dispatch({ serviceCheck: { scope, approval: { ...approval, openError: 'The browser could not be opened; use Open approval to try again' } } }) }
      }
      if (request.kind === 'shell') {
        await check()
        if (!this.connections || this.shellIdentities.has(scope.runId)) throw new Error('Pod execution authority is unavailable or already in use')
        const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
        const runtime = { executable: process.execPath, cli: app.isPackaged ? join(process.resourcesPath, 'apes/ape-shell.mjs') : join(dist, 'vendor/apes/ape-shell.mjs'), client: join(dist, 'runtime/shell-client.mjs') }
        const environment = await podEnvironment(this.root, scope.podId, runtime)
        const connection = await this.connections.podConnection(scope.podId)
        const authority = new AgentAuthority(connection, observe, previous, this.runtimeApproval?.allows(scope.podId)
          ? async (grantId, signal) => {
            if (!this.runtimeApproval?.allows(scope.podId)) return false
            await this.connections!.approveRuntimeGrant(connection, scope.podId, grantId, signal, () => this.runtimeApproval!.allows(scope.podId))
            return true
          }
          : undefined)
        const adapterPath = join(dist, 'vendor/pod-runtime-shapes.toml')
        const adapter = loadAdapter('pod-runtime', adapterPath)
        const argv = ['pod-runtime', 'run', '--pod', scope.podId, '--name', context.name, '--script', join(this.root, 'runs', scope.runId, 'run.mjs'), '--workspace', environment.workspace, '--home', environment.home, '--environment', JSON.stringify(visibleEnvironment(environment.environment))]
        const resolved = await resolveCommand(adapter, argv)
        const assignment = { grantId: '', command: { cliId: 'pod-runtime', adapterPath, adapterDigest: adapter.digest, argv, permission: resolved.permission } }
        await authority.authorize(assignment, controller.signal, `Pod: ${context.name}\nRun the stored script inside this Pod's managed runtime. Script changes remain within separately assigned permissions. This approval does not enable a schedule.\nScript: ${join(this.root, 'runs', scope.runId, 'run.mjs')}\nWorkspace: ${environment.workspace}\nHOME: ${environment.home}`)
        await check(); controller.signal.throwIfAborted()
        const monitoring = new AbortController()
        const monitor = (async () => {
          try { while (!monitoring.signal.aborted) { await delay(1000, undefined, { signal: monitoring.signal }); await retryInfrastructure(() => authority.assertActive(assignment.grantId, monitoring.signal), monitoring.signal, async (retry) => { if (!monitoring.signal.aborted) await this.dispatch({ serviceCheck: { scope, infrastructure: retry } }) }) } }
          catch (error) {
            if (!monitoring.signal.aborted) {
              console.error('Pod execution authority lost', error)
              try { await this.dispatch({ serviceCheck: { scope, authorityLost: true } }) }
              catch (cancelError) { console.error('Could not cancel the revoked Pod run', cancelError) }
            }
          }
        })()
        this.shellIdentities.set(scope.runId, { close: async () => { monitoring.abort(); await monitor } })
        return { home: environment.home, environment: environment.environment }
      }
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
        const result = await handleGate({ body: request.body, scope, connections: this.connections, check, checkGate: async (manifest, operation, grantId) => this.dispatch({ networkGateCheck: { scope, manifest, operation, grantId } }), signal: controller.signal })
        await check(); controller.signal.throwIfAborted(); return result
      }
      if (request.kind === 'mailArchive') {
        if (!this.credentials || !this.connections) throw new Error('Connection service unavailable')
        this.archiveService ??= new MailArchiveService(new ArchiveStore(join(this.root, 'mail-archive')))
        const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
        const result = await handleMailArchive({ service: this.archiveService, body: request.body, scope, root: this.root, helper: join(dist, 'native/pods-helper'), credentials: this.credentials, connections: this.connections, check, signal: controller.signal, observe, previous })
        await check(); controller.signal.throwIfAborted(); return result
      }
      if (request.kind === 'jev') {
        if (!this.credentials || !this.connections) throw new Error('Connection service unavailable')
        const assignment = assignedJev(state.resources, scope.podId, scope.capabilities)
        const vendor = join(__dirname, '../vendor').replace('/app.asar/', '/app.asar.unpacked/')
        const result = await executeJev(assignment, parseJevRequest(request.body), {
          vendor, credentials: this.credentials, signal: controller.signal, observe, previous, check,
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
        if (!this.credentials) throw new Error('Credential store is unavailable')
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
        const result = await executeHttp(state.resources, scope, parseHttpRequest(request.body), vendor, credentials, controller.signal, observe, previous, bearer)
        await check(); controller.signal.throwIfAborted(); return result
      }
      if (request.kind === undefined && request.body && typeof request.body === 'object' && 'sshInventory' in request.body) {
        if (!this.credentials) throw new Error('Credential store is unavailable')
        const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
        return await invokeSsh({ resources: state.resources, scope, body: request.body, dist, root: join(this.root, 'runs', scope.runId), credentials: this.credentials, signal: controller.signal, check, observe, previous })
      }
      if (request.body && typeof request.body === 'object' && ('applicationId' in request.body || 'application' in request.body)) {
        if (!this.credentials) throw new Error('Credential store is unavailable')
        const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
        const requested = programRequest(state.resources, scope.podId, scope.capabilities, request.body)
        const grant = await this.connections!.existingProgramGrant(scope.podId, requested.assignment, requested.argv)
        const resources = state.resources.map(item => item.id === requested.id ? { ...item, configuration: { ...item.configuration, grants: [...requested.assignment.grants.filter(item => item.permission !== grant.permission), grant] } } : item)
        const workspace = await podWorkspace(this.root, scope.podId)
        const directories = directoryPolicy(await assignedDirectories(this.root, scope.podId, resources))
        const result = await invokeProgram(resources, scope.podId, request.body, join(dist, 'native/pods-helper'), join(this.root, 'runs', scope.runId), this.credentials, { ...directories, workspace, capabilities: scope.capabilities, signal: controller.signal, assertCurrent: () => controller.signal.throwIfAborted(), registerDomain: async (path, ownerPid) => { await check({ path, ownerPid }); controller.signal.throwIfAborted() } }, observe, previous)
        await check(); controller.signal.throwIfAborted(); return result
      }
      const assignment = assignedMail(state.resources)
      if (assignment.identity.podId !== scope.podId) throw new Error('Agent identity belongs to another pod')
      const credentials = this.credentials
      if (!credentials) throw new Error('Credential store is unavailable')
      const identity = new PodIdentityManager(credentials)
      const authority = new AgentAuthority(identity.connection(assignment.identity, `pods:${scope.podId}`), observe, previous)
      const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
      const service = new MailService(join(dist, 'native/pods-helper'), join(dist, 'vendor'), authority, credentials)
      const value = await service.execute(assignment.mail, request.body, join(this.root, 'runs', scope.runId), { capabilities: scope.capabilities, assertCurrent: () => controller.signal.throwIfAborted(), signal: controller.signal, registerDomain: async (path, ownerPid) => { await check({ path, ownerPid }); controller.signal.throwIfAborted() } })
      await check(); controller.signal.throwIfAborted()
      return value
    }
    finally { controller.abort(); this.services.delete(request.id) }
  }

  lifecycle(event: 'suspend' | 'resume'): void { if (this.state.state === 'ready' && !this.stopping) this.child?.postMessage(event) }

  async stop(): Promise<void> {
    await this.setupReady
    await this.programs?.stop()
    await this.closeShellIdentities()
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
