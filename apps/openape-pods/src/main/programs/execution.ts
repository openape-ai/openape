import { AuthorityError, NonRetryableError } from '../../contracts/infrastructure'
import type { ProcessDomain } from '../../worker/runtime/sandbox'

export interface ExecutionObserver {
  pending?: (grantId: string, approvalUrl: string) => Promise<void>
  /** Persist the generic effect intent before this resolves. It does not grant authority. */
  authorized: (value: { grantId: string, write: boolean }) => Promise<void>
  starting?: () => void
  notStarted?: () => Promise<void>
}

export type ExecutionResult = { kind: 'completed', exitCode: number } | { kind: 'pending', exitCode: 75, grantId: string, approvalUrl: string }

function message(value: unknown, operationId: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ape-shell lifecycle frame')
  const frame = value as Record<string, unknown>
  if (frame.version !== 1 || frame.operationId !== operationId || typeof frame.state !== 'string') throw new Error('ape-shell lifecycle belongs to another operation')
  return frame
}

/** Reads the private ape-shell channel. stdout and stderr can never supply execution authority or receipts. */
export async function observeExecution(domain: ProcessDomain, operationId: string, observer: ExecutionObserver, signal: AbortSignal): Promise<ExecutionResult> {
  if (!domain.authority) throw new Error('ape-shell execution channel is missing')
  const channel = domain.authority
  let state: 'waiting' | 'authorized' | 'starting' | 'started' | 'completed' | 'not-started' | 'unknown' = 'waiting'
  let failure: Error | undefined
  let exitCode: number | undefined
  let pending: { grantId: string, approvalUrl: string } | undefined
  const stop = () => domain.cancel()
  signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop()
  const accept = async (value: unknown) => {
    const frame = message(value, operationId)
    if (['completed', 'not-started', 'unknown'].includes(state)) throw new Error('ape-shell sent data after its terminal receipt')
    if (frame.state === 'pending' && state === 'waiting') {
      if (typeof frame.grantId !== 'string' || !frame.grantId || typeof frame.approvalUrl !== 'string' || !/^https?:\/\//.test(frame.approvalUrl)) throw new Error('Invalid ape-shell pending decision')
      pending = { grantId: frame.grantId, approvalUrl: frame.approvalUrl }
      await observer.pending?.(frame.grantId, frame.approvalUrl); return
    }
    if (frame.state === 'authorized' && state === 'waiting') {
      if (typeof frame.grantId !== 'string' || !frame.grantId || typeof frame.write !== 'boolean') throw new Error('Invalid ape-shell authorization receipt')
      state = 'authorized'
      await observer.authorized({ grantId: frame.grantId, write: frame.write })
      signal.throwIfAborted()
      await new Promise<void>((resolve, reject) => channel.write(`${JSON.stringify({ version: 1, operationId, state: 'execute' })}\n`, error => error ? reject(error) : resolve()))
      return
    }
    if (frame.state === 'starting' && state === 'authorized') { state = 'starting'; observer.starting?.(); return }
    if (frame.state === 'started' && state === 'starting') {
      if (!Number.isSafeInteger(frame.pid) || Number(frame.pid) < 1) throw new Error('Invalid ape-shell process identity')
      state = 'started'; return
    }
    if (frame.state === 'completed' && state === 'started') {
      if (!Number.isInteger(frame.exitCode) || Number(frame.exitCode) < 0 || Number(frame.exitCode) > 255) throw new Error('Invalid ape-shell process result')
      state = 'completed'; exitCode = Number(frame.exitCode); return
    }
    if (frame.state === 'not-started' && ['waiting', 'authorized'].includes(state)) {
      state = 'not-started'
      await observer.notStarted?.()
      failure = new AuthorityError(typeof frame.error === 'string' ? frame.error : 'ape-shell refused execution'); return
    }
    if (frame.state === 'unknown' && ['authorized', 'starting', 'started'].includes(state)) {
      state = 'unknown'; failure = new NonRetryableError('Program outcome is unknown; inspect the execution before retrying'); return
    }
    throw new Error('ape-shell lifecycle transition is invalid')
  }
  const reading = (async () => {
    try {
      let buffer = ''; let received = 0
      channel.setEncoding('utf8')
      for await (const bytes of channel) {
        buffer += String(bytes); received += Buffer.byteLength(String(bytes))
        if (received > 1024 * 1024 || Buffer.byteLength(buffer) > 65536) throw new Error('ape-shell lifecycle exceeds its size bound')
        for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
          await accept(JSON.parse(line))
        }
      }
      if (buffer) throw new Error('ape-shell lifecycle was truncated')
    }
    catch (error) { failure = error instanceof Error ? error : new Error('ape-shell lifecycle failed'); domain.cancel() }
  })()
  try {
    const code = await domain.completed
    await reading
    signal.throwIfAborted()
    if (failure) throw failure
    if (pending && state === 'waiting' && exitCode === undefined && code === 75) return { kind: 'pending', exitCode: 75, ...pending }
    if (exitCode === undefined || code !== exitCode) throw new NonRetryableError(`Program closed without a verified completion receipt (state ${state}, process exit ${code}, receipt ${exitCode ?? 'missing'})`)
    return { kind: 'completed', exitCode }
  }
  finally { signal.removeEventListener('abort', stop); domain.cancel(); await domain.completed; await reading }
}
