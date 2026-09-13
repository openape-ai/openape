import { randomUUID } from 'node:crypto'
import type { ServiceScope } from '../../contracts/services'

export class MailBridge {
  private pending = new Map<string, { resolve: (value: unknown) => void, reject: (error: Error) => void }>()
  constructor(private readonly send: (value: unknown) => void) {}
  accept(value: unknown): void {
    if (!value || typeof value !== 'object') throw new Error('Invalid mail broker reply')
    const reply = value as { id?: string, error?: string, value?: unknown }
    const pending = reply.id ? this.pending.get(reply.id) : undefined
    if (!pending || !reply.id) throw new Error('Unexpected mail broker reply')
    this.pending.delete(reply.id)
    if (reply.error) pending.reject(new Error(reply.error))
    else pending.resolve(reply.value)
  }

  async execute(scope: ServiceScope, body: unknown, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    if (this.pending.size >= 16) throw new Error('Mail broker queue is full')
    const id = randomUUID()
    const cancel = () => this.send({ serviceCancel: id })
    const timeout = setTimeout(cancel, 90000)
    signal.addEventListener('abort', cancel, { once: true })
    try {
      return await new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.send({ service: { id, scope, body } }); if (signal.aborted) cancel() })
    }
    finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel) }
  }
}
