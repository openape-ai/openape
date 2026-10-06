import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { TerminalView } from '../../contracts/programs'
import type { ExternalShell } from '../shell/session'

export class ApplicationLaunch {
  readonly completed: Promise<void>
  private child?: ChildProcess
  private state: TerminalView['state'] = 'starting'
  private output = ''
  private sequence = 0
  private exitCode: number | null = null
  private error: string | null = null

  constructor(readonly id: string, readonly podId: string, private readonly shell: ExternalShell) {
    this.completed = this.run().catch((error: unknown) => { this.error = error instanceof Error ? error.message : 'Application launch failed' }).finally(() => { this.state = 'closed'; this.sequence++ })
  }

  private async run(): Promise<void> {
    try {
      const launcher = await this.shell.ready
      this.child = spawn('/bin/sh', [launcher], { env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] })
      const exited = new Promise<number>((resolve, reject) => { this.child!.once('error', reject); this.child!.once('close', code => resolve(code ?? 1)) })
      const collect = (bytes: Buffer) => { this.output = (this.output + bytes.toString()).slice(-24000); this.sequence++ }
      this.child.stdout!.on('data', collect); this.child.stderr!.on('data', collect)
      this.state = 'running'; this.sequence++
      this.exitCode = await exited
      await this.shell.completed
      if (this.shell.error) throw new Error(this.shell.error)
    }
    finally { this.shell.close(); await this.shell.completed }
  }

  close(): void { this.shell.close() }
  view(): TerminalView { return { sessionId: this.id, podId: this.podId, state: this.state, sequence: this.sequence, output: this.output, exitCode: this.exitCode, error: this.error } }
}
