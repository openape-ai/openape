import type { PodsRelease } from '@openape/pods-protocol'
import type { UpdateView } from '../contracts/updates'

export interface UpdateOperations {
  check: () => Promise<PodsRelease | null>
  download: (release: PodsRelease, progress: (percent: number) => void) => Promise<string>
  verify: (archive: string, release: PodsRelease) => Promise<void>
  freeze: () => Promise<void>
  backup: () => Promise<string>
  resume: () => Promise<void>
  install: () => void | Promise<void>
}
export class AutomaticUpdate {
  readonly view: UpdateView
  private pending: Promise<UpdateView> | null = null
  private release: PodsRelease | null = null
  private handedOff = false
  constructor(currentVersion: string, private readonly operations: UpdateOperations | null) {
    this.view = { state: operations ? 'idle' : 'disabled', currentVersion, version: null, progress: 0, error: null, backup: null }
  }

  private async exclusive(action: () => Promise<void>): Promise<UpdateView> {
    if (this.pending) return this.pending
    if (!this.operations || this.handedOff) return { ...this.view }
    this.pending = (async () => {
      try { await action() }
      catch (error) { this.fail(error) }
      finally { this.pending = null }
      return { ...this.view }
    })()
    return this.pending
  }

  fail(error: unknown): void {
    this.view.state = this.handedOff ? 'restart-required' : 'error'; this.view.error = error instanceof Error ? error.message : 'Update failed'
  }

  check(): Promise<UpdateView> {
    return this.exclusive(async () => {
      this.view.state = 'checking'; this.view.error = null
      this.release = await this.operations!.check()
      this.view.version = this.release?.version ?? null
      this.view.state = this.release ? 'available' : 'idle'
    })
  }

  install(): Promise<UpdateView> {
    return this.exclusive(async () => {
      if (!this.release) throw new Error('Check for an update first')
      const operations = this.operations!
      this.view.state = 'downloading'; this.view.error = null; this.view.progress = 0
      const archive = await operations.download(this.release, (progress) => { this.view.progress = Math.min(100, Math.max(0, progress)) })
      await operations.verify(archive, this.release)
      this.view.state = 'preparing'
      let frozen = false
      try {
        await operations.freeze(); frozen = true
        this.view.backup = await operations.backup()
        this.view.state = 'installing'
        await operations.install()
        this.handedOff = true
      }
      finally { if (frozen && !this.handedOff) await operations.resume() }
    })
  }
}
