import { randomUUID } from 'node:crypto'
import type { MachineLaunch } from './ape-shell'

export type PreparationPurpose = 'validation' | 'dependencies'
export type PreparedMachine = Omit<MachineLaunch, 'operationId' | 'executableHash' | 'files'>

/** Desktop-provided identity transport. This never authorizes the requested program. */
export class ExecutionIdentityBridge {
  private pending = new Map<string, { resolve: (value: PreparedMachine) => void, reject: (error: Error) => void }>()
  constructor(private readonly send: (message: unknown) => void) {}

  accept(value: { id: string, machine?: PreparedMachine, error?: string }): void {
    const pending = this.pending.get(value.id)
    if (!pending) return
    this.pending.delete(value.id)
    if (value.error || !value.machine) pending.reject(new Error(value.error ?? 'Execution identity is unavailable'))
    else pending.resolve(value.machine)
  }

  async acquire(podId: string, purpose: PreparationPurpose, signal: AbortSignal): Promise<{ machine: PreparedMachine, close: () => Promise<void> }> {
    signal.throwIfAborted()
    const id = randomUUID()
    const release = () => { this.send({ executionIdentity: { id, action: 'release' } }) }
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort = () => {}
    try {
      const machine = await new Promise<PreparedMachine>((resolve, reject) => {
        abort = () => reject(new Error('Execution preparation was cancelled'))
        this.pending.set(id, { resolve, reject })
        timer = setTimeout(() => reject(new Error('Execution identity timed out')), 30000)
        signal.addEventListener('abort', abort, { once: true })
        this.send({ executionIdentity: { id, action: 'acquire', podId, purpose } })
        if (signal.aborted) abort()
      })
      signal.throwIfAborted()
      return { machine, close: async () => release() }
    }
    catch (error) { release(); throw error }
    finally { clearTimeout(timer); this.pending.delete(id); signal.removeEventListener('abort', abort) }
  }
}
