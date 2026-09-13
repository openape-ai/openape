import { utilityProcess } from 'electron'
import type { UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { WorkerStatus } from '../contracts/ipc'

export class FixtureWorker {
  private child: UtilityProcess | null = null
  private stopping = false
  private state: WorkerStatus = { state: 'starting', pid: null, error: null }
  constructor(private readonly publish: (status: WorkerStatus) => void) {}
  start(root: string): void {
    this.child = utilityProcess.fork(join(__dirname, '../worker/entry.cjs'), [], { cwd: root, env: { HOME: root, TMPDIR: root, PATH: '/usr/bin:/bin' }, serviceName: 'OpenApe Pods Fixture Worker', stdio: 'pipe' })
    const child = this.child
    const reportError = (error: string) => { this.state = { state: 'error', pid: child.pid ?? null, error }; this.publish(this.state) }
    child.on('message', (message: unknown) => {
      if (message !== 'ready') { reportError('Unexpected worker message'); child.kill(); return }
      this.state = { state: 'ready', pid: child.pid ?? null, error: null }; this.publish(this.state)
    })
    child.on('exit', (code) => {
      this.state = this.stopping ? { state: 'stopped', pid: null, error: null } : { state: 'error', pid: null, error: `Worker exited (${code}). Quit and reopen Pods to recover.` }
      this.child = null; this.publish(this.state)
    })
    child.stderr?.on('data', (data: Buffer) => { console.error('[pods worker]', data.toString()) })
  }

  async stop(): Promise<void> {
    this.stopping = true
    const child = this.child
    if (!child) return
    await new Promise<void>((resolve) => {
      const deadline = setTimeout(() => child.kill(), 2000)
      child.once('exit', () => { clearTimeout(deadline); resolve() })
      child.postMessage('stop')
    })
  }
}
