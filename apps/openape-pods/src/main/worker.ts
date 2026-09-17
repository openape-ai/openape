import { shellIdentity } from './shell/identity'
import { podEnvironment } from '../runtime/environment'
import { podWorkspace } from './programs/console'
import { invokeProgram, programRequest } from './programs/invoke'
import { ProgramManager } from './programs/manager'
import type { ProgramDefinition, ProgramCommand } from '../contracts/programs'
import type { ProgramInternal } from '../worker/resources/programs'
import { parseHttpPermission, parseHttpRequest } from '../contracts/http'
import { executeHttp } from './programs/http-service'
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
import type { MasterCommand, MasterView } from '../contracts/master'
import { realpathSync } from 'node:fs'
import { parseServiceScope } from '../contracts/services'
import type { ServiceCheck, ServiceRequest } from '../contracts/services'
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
import { app, utilityProcess } from 'electron'
import type { UtilityProcess } from 'electron'
import { dirname, join } from 'node:path'
import type { WorkerStatus } from '../contracts/ipc'

export class FixtureWorker {
  private shellIdentities = new Map<string, Awaited<ReturnType<typeof shellIdentity>>>()
  private programs: ProgramManager | null = null
  private connections: ConnectionManager | null = null
  private providerGateway: Awaited<ReturnType<typeof startAgentGateway>> | null = null
  private providerAbort = new AbortController()
  private setupReady: Promise<void> | null = null
  private child: UtilityProcess | null = null
  private stopping = false
  private root = ''
  private credentials: CredentialCache | null = null
  private services = new Map<string, AbortController>()
  private pending = new Map<string, { resolve: (state: unknown) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout> }>()
  private state: WorkerStatus = { state: 'starting', pid: null, error: null }
  constructor(private readonly publish: (status: WorkerStatus) => void) {}
  start(root: string): void {
    try { assertPilotRuntime() }
    catch (error) { this.state = { state: 'error', pid: null, error: error instanceof Error ? error.message : 'Unsupported Mac' }; this.publish(this.state); return }
    this.root = realpathSync(root)
    this.credentials = createMacOSCredentialCache(join(this.root, 'credentials'))
    const fixturePort = process.env.NODE_ENV === 'test' ? process.env.OPENAPE_PODS_FIXTURE_MODEL_PORT : undefined
    if (fixturePort && (!/^\d+$/.test(fixturePort) || Number(fixturePort) < 1024 || Number(fixturePort) > 65535)) throw new Error('Invalid synthetic model port')
    this.child = utilityProcess.fork(join(__dirname, '../worker/entry.cjs'), [], { cwd: root, env: { HOME: root, TMPDIR: root, PATH: '/usr/bin:/bin', PODS_RUNTIME_EXECUTABLE: process.execPath, ...(fixturePort ? { PODS_FIXTURE_MODEL_PORT: fixturePort } : {}) }, serviceName: 'OpenApe Pods Fixture Worker', stdio: 'pipe' })
    const child = this.child
    const reportError = (error: string) => { this.state = { state: 'error', pid: child.pid ?? null, error }; this.publish(this.state) }
    child.on('message', (message: unknown) => {
      if (message && typeof message === 'object' && 'programCancel' in message) { this.programs?.cancelPod(String(message.programCancel)); return }
      if (message && typeof message === 'object' && 'serviceCancel' in message) { this.services.get(String(message.serviceCancel))?.abort(new Error('Pod tool call cancelled')); return }
      if (message && typeof message === 'object' && 'service' in message) {
        const request = message.service as ServiceRequest
        const respond = async () => {
          let reply: { id: string, value?: unknown, error?: string }
          try { reply = { id: request.id, value: await this.executeService(request) } }
          catch (error) { reply = { id: request.id, error: error instanceof Error ? error.message : 'Mail broker failed' } }
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
    })
    this.providerGateway = await startAgentGateway({ provider: (body, signal) => this.connections!.provider(body, signal), tool: async () => { throw new Error('Model credential gateway has no tools') } }, this.providerAbort.signal)
    this.programs = new ProgramManager(join(this.root, 'authentication'), runtime.helper, this.credentials!, this.connections, podId => this.resources({ type: 'list', podId }), command => this.dispatch({ program: command }))
    await this.connections.initialize(async () => { await this.dispatch({ inspectCredentials: true }); await this.credentials!.reconcileScriptSecrets(await this.dispatch({ credentialInventory: true }) as { id: string, podId: string }[]); await this.finishDeletions() })
  }

  private async finishDeletions(): Promise<void> {
    const jobs = await this.dispatch({ data: { type: 'jobs' } }) as DeletionJob[]
    for (const job of jobs) { await this.connections!.purgePodKeys(job.podId, job.keyIds); await this.dispatch({ data: { type: 'finishDeletion', podId: job.podId } }) }
  }

  async data(command: DataInternal): Promise<DataView> {
    await this.setupReady
    if (command.type !== 'status' && (this.connections?.busy() || this.programs?.busy())) throw new Error('Finish or cancel account setup before changing application data')
    const view = parseDataView(await this.dispatch({ data: command }))
    if (command.type === 'cleanup' || command.type === 'deletePod') { await this.finishDeletions(); return parseDataView(await this.dispatch({ data: { type: 'status' } })) }
    return view
  }

  cancelProgram(podId: string): void { this.programs?.cancelPod(podId) }

  private async closeShellIdentities(): Promise<void> {
    const identities = [...this.shellIdentities.values()]; this.shellIdentities.clear()
    await Promise.all(identities.map(identity => identity.close()))
  }

  async program(command: ProgramCommand, definition?: ProgramDefinition, file?: string) {
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

  async master(command: MasterCommand): Promise<MasterView> { return parseMasterView(await this.dispatch({ master: command })) }

  async scripts(command: ScriptCommand): Promise<ScriptView> { return parseScriptView(await this.dispatch({ scripts: command })) }

  async details(command: DetailsCommand): Promise<PodDetails> { return parsePodDetails(await this.dispatch({ details: command })) }

  async request(command: WorkspaceCommand): Promise<WorkspaceState> { return parseWorkspace(await this.dispatch(command)) }

  async resources(command: InternalResourceCommand): Promise<ResourceState> {
    await this.setupReady
    if (command.type === 'assignHttp') {
      if (!this.connections) throw new Error('Connection setup is not ready')
      const before = parseResourceState(await this.dispatch({ resource: { type: 'list', podId: command.podId } }))
      if (before.epoch !== command.epoch) throw new Error('Pod or HTTP permissions changed; reload before assigning access')
      const permission = parseHttpPermission(command.permission)
      const current = before.resources.filter(item => item.kind === 'tool' && item.state === 'ready')
      if (!current.some(item => item.configuration.type === 'http' && item.configuration.origin === permission.origin) && current.length >= 16) throw new Error('This pod already has 16 tools')
      const vendor = join(__dirname, '../vendor').replace('/app.asar/', '/app.asar.unpacked/')
      const authority = await this.connections.approve(command.podId, join(vendor, 'pod-http-shapes.toml'), permission.methods.map(method => ['pod-http', 'request', '--origin', permission.origin, '--method', method]))
      return parseResourceState(await this.dispatch({ resource: { type: 'approveHttp', podId: command.podId, epoch: command.epoch, permission, authority } }))
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

  async runs(command: RunCommand): Promise<RunView> { await this.setupReady; return parseRunView(await this.dispatch({ run: command })) }

  async scheduling(command: ScheduleCommand): Promise<ScheduleView> { return parseScheduleView(await this.dispatch({ schedule: command })) }

  private dispatch(command: { program: ProgramInternal } | { scripts: ScriptCommand } | { data: DataInternal } | { setup: SetupInternal } | { inspectCredentials: true } | { credentialInventory: true } | { provider: { port: number, capability: string } | null } | { master: MasterCommand } | { credentialCheck: ServiceCheck & { alias: string } } | { serviceCheck: ServiceCheck } | WorkspaceCommand | { details: DetailsCommand } | { resource: InternalResourceCommand } | { run: RunCommand } | { schedule: ScheduleCommand }): Promise<unknown> {
    const child = this.child
    if (!child || this.state.state !== 'ready' || this.stopping) return Promise.reject(new Error('Worker is not ready'))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Worker response timed out; reload state before retrying')) }, 'data' in command ? 15 * 60 * 1000 : ('run' in command && command.run.type === 'recover') || 'inspectCredentials' in command ? 30000 : 10000)
      this.pending.set(id, { resolve, reject, timer }); child.postMessage({ id, command })
    })
  }

  private async executeService(request: ServiceRequest): Promise<unknown> {
    if (!request || typeof request.id !== 'string' || !/^[a-f0-9-]{36}$/.test(request.id) || this.services.has(request.id) || this.services.size >= 16) throw new Error('Invalid or excessive broker request')
    if (request.kind !== undefined && request.kind !== 'credential' && request.kind !== 'http' && request.kind !== 'shell' && request.kind !== 'shellClose') throw new Error('Unsupported broker service')
    const scope = parseServiceScope(request.scope)
    const controller = new AbortController(); this.services.set(request.id, controller)
    const check = async (domain?: { path: string, ownerPid: number }) => parseResourceState(await this.dispatch({ serviceCheck: { scope, ...(domain ? { domain } : {}) } }))
    try {
      if (request.kind === 'shellClose') {
        await this.shellIdentities.get(scope.runId)?.close(); this.shellIdentities.delete(scope.runId); return true
      }
      if (request.kind === 'shell') {
        await check()
        if (!this.connections || this.shellIdentities.has(scope.runId)) throw new Error('Pod shell identity is unavailable or already in use')
        const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
        const runtime = { executable: process.execPath, cli: app.isPackaged ? join(process.resourcesPath, 'apes/ape-shell.mjs') : join(dist, 'vendor/apes/ape-shell.mjs'), client: join(dist, 'runtime/shell-client.mjs') }
        const environment = await podEnvironment(this.root, scope.podId, runtime)
        const identity = await shellIdentity(this.root, scope.podId, this.connections)
        try { await check(); controller.signal.throwIfAborted() }
        catch (error) { await identity.close(); throw error }
        this.shellIdentities.set(scope.runId, identity)
        return { home: environment.home, environment: environment.environment, shell: { cli: runtime.cli, environment: { ...environment.environment, APES_AUTH_FILE: identity.path } } }
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
      if (request.kind === 'http') {
        if (!this.credentials) throw new Error('Credential store is unavailable')
        const vendor = join(__dirname, '../vendor').replace('/app.asar/', '/app.asar.unpacked/')
        const result = await executeHttp(state.resources, scope, parseHttpRequest(request.body), vendor, this.credentials, controller.signal)
        await check(); controller.signal.throwIfAborted(); return result
      }
      if (request.body && typeof request.body === 'object' && ('applicationId' in request.body || 'application' in request.body)) {
        if (!this.credentials) throw new Error('Credential store is unavailable')
        const dist = join(__dirname, '..').replace('/app.asar/', '/app.asar.unpacked/')
        const requested = programRequest(state.resources, scope.podId, scope.capabilities, request.body)
        const grant = await this.connections!.existingProgramGrant(scope.podId, requested.assignment, requested.argv)
        const resources = state.resources.map(item => item.id === requested.id ? { ...item, configuration: { ...item.configuration, grants: [...requested.assignment.grants.filter(item => item.permission !== grant.permission), grant] } } : item)
        const workspace = await podWorkspace(this.root, scope.podId)
        const result = await invokeProgram(resources, scope.podId, request.body, join(dist, 'native/pods-helper'), join(this.root, 'runs', scope.runId), this.credentials, { workspace, capabilities: scope.capabilities, signal: controller.signal, assertCurrent: () => controller.signal.throwIfAborted(), registerDomain: async (path, ownerPid) => { await check({ path, ownerPid }); controller.signal.throwIfAborted() } })
        await check(); controller.signal.throwIfAborted(); return result
      }
      const assignment = assignedMail(state.resources)
      if (assignment.identity.podId !== scope.podId) throw new Error('Agent identity belongs to another pod')
      const credentials = this.credentials
      if (!credentials) throw new Error('Credential store is unavailable')
      const identity = new PodIdentityManager(credentials)
      const authority = new AgentAuthority(identity.connection(assignment.identity, `pods:${scope.podId}`))
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
