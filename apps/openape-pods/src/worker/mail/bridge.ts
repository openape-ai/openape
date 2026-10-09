import { AuthorityError, InfrastructureError, NonRetryableError, infrastructureFailure } from '../../contracts/infrastructure'
import { randomUUID } from 'node:crypto'
import type { ServiceScope } from '../../contracts/services'

// A service call that does not answer within this time is cancelled; a wait for an IdP decision is exempt.
const serviceTimeoutMs = 16 * 60 * 1000

export class MailBridge {
  private pending = new Map<string, { resolve: (value: unknown) => void, reject: (error: Error) => void }>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private parked = new Set<string>()
  constructor(private readonly send: (value: unknown) => void) {}
  accept(value: unknown): void {
    if (!value || typeof value !== 'object') throw new Error('Invalid mail broker reply')
    const reply = value as { id?: string, error?: string, value?: unknown, infrastructure?: unknown, authority?: boolean, nonRetryable?: boolean }
    const pending = reply.id ? this.pending.get(reply.id) : undefined
    if (!pending || !reply.id) throw new Error('Unexpected mail broker reply')
    this.pending.delete(reply.id)
    if (reply.error) pending.reject(reply.authority === true ? new AuthorityError(reply.error) : reply.infrastructure ? new InfrastructureError(infrastructureFailure(reply.infrastructure)) : reply.nonRetryable === true ? new NonRetryableError(reply.error) : new Error(reply.error))
    else pending.resolve(reply.value)
  }

  /**
   * A call parked while its run waits for the owner's decision at the IdP executes nothing, so it neither
   * counts against the queue limit nor times out; it ends with its run or the decision.
   */
  park(id: string, parked: boolean): void {
    if (!this.pending.has(id)) return
    if (parked) {
      this.parked.add(id); clearTimeout(this.timers.get(id))
    }
    else if (this.parked.delete(id)) {
      this.arm(id)
    }
  }

  queued(): number { return this.pending.size - this.parked.size }

  private arm(id: string): void {
    clearTimeout(this.timers.get(id))
    this.timers.set(id, setTimeout(() => this.send({ serviceCancel: id }), serviceTimeoutMs))
  }

  async execute(scope: ServiceScope, body: unknown, signal: AbortSignal, kind?: 'gate' | 'mailArchive' | 'mailMove' | 'credential' | 'jev' | 'http' | 'shell' | 'shellClose'): Promise<unknown> {
    signal.throwIfAborted()
    if (this.queued() >= 16) throw new Error('Mail broker queue is full')
    const id = randomUUID()
    const cancel = () => this.send({ serviceCancel: id })
    signal.addEventListener('abort', cancel, { once: true })
    try {
      return await new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.arm(id); this.send({ service: { id, scope, body, ...(kind ? { kind } : {}) } }); if (signal.aborted) cancel() })
    }
    finally { clearTimeout(this.timers.get(id)); this.timers.delete(id); this.parked.delete(id); signal.removeEventListener('abort', cancel) }
  }
}
