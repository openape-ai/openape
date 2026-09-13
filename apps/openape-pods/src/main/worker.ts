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
import { utilityProcess } from 'electron'
import type { UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { WorkerStatus } from '../contracts/ipc'

export class FixtureWorker {
  private child: UtilityProcess | null = null
  private stopping = false
  private root = ''
  private credentials: CredentialCache | null = null
  private services = new Map<string, AbortController>()
  private pending = new Map<string, { resolve: (state: unknown) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout> }>()
  private state: WorkerStatus = { state: 'starting', pid: null, error: null }
  constructor(private readonly publish: (status: WorkerStatus) => void) {}
  start(root: string): void {
    this.root = realpathSync(root)
    this.credentials = createMacOSCredentialCache(join(this.root, 'credentials'))
    this.child = utilityProcess.fork(join(__dirname, '../worker/entry.cjs'), [], { cwd: root, env: { HOME: root, TMPDIR: root, PATH: '/usr/bin:/bin', PODS_RUNTIME_EXECUTABLE: process.execPath }, serviceName: 'OpenApe Pods Fixture Worker', stdio: 'pipe' })
    const child = this.child
    const reportError = (error: string) => { this.state = { state: 'error', pid: child.pid ?? null, error }; this.publish(this.state) }
    child.on('message', (message: unknown) => {
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
      this.state = { state: 'ready', pid: child.pid ?? null, error: null }; this.publish(this.state)
    })
    child.on('exit', (code) => {
      for (const service of this.services.values()) service.abort(new Error('Owning worker stopped'))
      this.state = this.stopping ? { state: 'stopped', pid: null, error: null } : { state: 'error', pid: null, error: `Worker exited (${code}). Quit and reopen Pods to recover.` }
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Worker stopped before replying')) }
      this.pending.clear()
      this.child = null; this.publish(this.state)
    })
    child.stderr?.on('data', (data: Buffer) => { console.error('[pods worker]', data.toString()) })
  }

  async details(command: DetailsCommand): Promise<PodDetails> { return parsePodDetails(await this.dispatch({ details: command })) }

  async request(command: WorkspaceCommand): Promise<WorkspaceState> { return parseWorkspace(await this.dispatch(command)) }

  async resources(command: InternalResourceCommand): Promise<ResourceState> { return parseResourceState(await this.dispatch({ resource: command })) }

  async runs(command: RunCommand): Promise<RunView> { return parseRunView(await this.dispatch({ run: command })) }

  async scheduling(command: ScheduleCommand): Promise<ScheduleView> { return parseScheduleView(await this.dispatch({ schedule: command })) }

  private dispatch(command: { serviceCheck: ServiceCheck } | WorkspaceCommand | { details: DetailsCommand } | { resource: InternalResourceCommand } | { run: RunCommand } | { schedule: ScheduleCommand }): Promise<unknown> {
    const child = this.child
    if (!child || this.state.state !== 'ready' || this.stopping) return Promise.reject(new Error('Worker is not ready'))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Worker response timed out; reload state before retrying')) }, 'run' in command && command.run.type === 'recover' ? 30000 : 10000)
      this.pending.set(id, { resolve, reject, timer }); child.postMessage({ id, command })
    })
  }

  private async executeService(request: ServiceRequest): Promise<unknown> {
    if (!request || typeof request.id !== 'string' || !/^[a-f0-9-]{36}$/.test(request.id) || this.services.has(request.id) || this.services.size >= 16) throw new Error('Invalid or excessive broker request')
    const scope = parseServiceScope(request.scope)
    const controller = new AbortController(); this.services.set(request.id, controller)
    const check = async (domain?: { path: string, ownerPid: number }) => parseResourceState(await this.dispatch({ serviceCheck: { scope, ...(domain ? { domain } : {}) } }))
    try {
      const state = await check()
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
