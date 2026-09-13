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
  private pending = new Map<string, { resolve: (state: unknown) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout> }>()
  private state: WorkerStatus = { state: 'starting', pid: null, error: null }
  constructor(private readonly publish: (status: WorkerStatus) => void) {}
  start(root: string): void {
    this.child = utilityProcess.fork(join(__dirname, '../worker/entry.cjs'), [], { cwd: root, env: { HOME: root, TMPDIR: root, PATH: '/usr/bin:/bin', PODS_RUNTIME_EXECUTABLE: process.execPath }, serviceName: 'OpenApe Pods Fixture Worker', stdio: 'pipe' })
    const child = this.child
    const reportError = (error: string) => { this.state = { state: 'error', pid: child.pid ?? null, error }; this.publish(this.state) }
    child.on('message', (message: unknown) => {
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

  private dispatch(command: WorkspaceCommand | { details: DetailsCommand } | { resource: InternalResourceCommand } | { run: RunCommand } | { schedule: ScheduleCommand }): Promise<unknown> {
    const child = this.child
    if (!child || this.state.state !== 'ready' || this.stopping) return Promise.reject(new Error('Worker is not ready'))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Worker response timed out; reload state before retrying')) }, 'run' in command && command.run.type === 'recover' ? 30000 : 10000)
      this.pending.set(id, { resolve, reject, timer }); child.postMessage({ id, command })
    })
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
