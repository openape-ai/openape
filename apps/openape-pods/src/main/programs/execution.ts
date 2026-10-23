import type { OpenApeOwnerScriptAuthority } from '@openape/core'
import { AuthorityError, InfrastructureError, NonRetryableError, PermissionUnavailableError, infrastructureFailure } from '../../contracts/infrastructure'
import type { PermissionRefusal } from '../../contracts/infrastructure'
import type { ProcessDomain } from '../../worker/runtime/sandbox'

export type ExecutionAuthorization = { grantId: string, write: boolean, authority?: { source: 'grant', grantId: string } } | { authority: OpenApeOwnerScriptAuthority, write: false, grantId?: never }
export interface ExecutionObserver {
  pending?: (grantId: string, approvalUrl: string) => Promise<void>
  /** Persist the matching effect or root lifecycle boundary before acknowledging dispatch. */
  authorized: (value: ExecutionAuthorization) => Promise<void>
  starting?: () => void
  notStarted?: () => Promise<void>
  completed?: (value: { exitCode: number }) => Promise<void>
}

export type ExecutionResult = { kind: 'completed', exitCode: number } | { kind: 'pending', exitCode: 75, grantId: string, approvalUrl: string }

function message(value: unknown, operationId: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ape-shell lifecycle frame')
  const frame = value as Record<string, unknown>
  if (frame.version !== 1 || frame.operationId !== operationId || typeof frame.state !== 'string') throw new Error('ape-shell lifecycle belongs to another operation')
  return frame
}

/** Reads the private ape-shell channel. stdout and stderr can never supply execution authority or receipts. */
export async function observeExecution(domain: ProcessDomain, operationId: string, observer: ExecutionObserver, signal: AbortSignal, ownerAuthority?: OpenApeOwnerScriptAuthority): Promise<ExecutionResult> {
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
      if (ownerAuthority) throw new Error('An owner-activated script cannot request an IdP start decision')
      if (typeof frame.grantId !== 'string' || !frame.grantId || typeof frame.approvalUrl !== 'string' || !/^https?:\/\//.test(frame.approvalUrl)) throw new Error('Invalid ape-shell pending decision')
      pending = { grantId: frame.grantId, approvalUrl: frame.approvalUrl }
      await observer.pending?.(frame.grantId, frame.approvalUrl); return
    }
    if (frame.state === 'authorized' && state === 'waiting') {
      let authorization: ExecutionAuthorization
      if (ownerAuthority) {
        const authority = frame.authority as OpenApeOwnerScriptAuthority | undefined
        if (frame.grantId !== undefined || frame.write !== false || !authority || Object.keys(authority).length !== Object.keys(ownerAuthority).length || Object.entries(ownerAuthority).some(([key, value]) => authority[key as keyof OpenApeOwnerScriptAuthority] !== value)) throw new Error('ape-shell owner activation does not match the selected script')
        authorization = { authority: ownerAuthority, write: false }
      }
      else {
        const authority = frame.authority as { source?: unknown, grantId?: unknown } | undefined
        if (typeof frame.grantId !== 'string' || !frame.grantId || typeof frame.write !== 'boolean' || (authority && (authority.source !== 'grant' || authority.grantId !== frame.grantId))) throw new Error('Invalid ape-shell authorization receipt')
        authorization = { grantId: frame.grantId, write: frame.write, authority: { source: 'grant', grantId: frame.grantId } }
      }
      state = 'authorized'
      await observer.authorized(authorization)
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
      failure = notStartedFailure(frame); return
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
    await observer.completed?.({ exitCode })
    return { kind: 'completed', exitCode }
  }
  finally { signal.removeEventListener('abort', stop); domain.cancel(); await domain.completed; await reading }
}

function notStartedFailure(frame: Record<string, unknown>): Error {
  const text = typeof frame.error === 'string' ? frame.error : 'ape-shell refused execution'
  const failure = frame.failure as Record<string, unknown> | undefined
  if (failure && typeof failure === 'object' && !Array.isArray(failure)) {
    if (failure.kind === 'permission' && Object.keys(failure).every(key => ['kind', 'state', 'grantId'].includes(key)) && typeof failure.state === 'string' && ['missing', 'pending', 'denied', 'revoked', 'expired', 'used', 'withdrawn'].includes(failure.state) && (failure.grantId === undefined || (typeof failure.grantId === 'string' && failure.grantId))) return new PermissionUnavailableError(text, { state: failure.state as PermissionRefusal['state'], ...(failure.grantId === undefined ? {} : { grantId: failure.grantId as string }) })
    if (failure.kind === 'infrastructure' && Object.keys(failure).every(key => ['kind', 'phase', 'retryAfterMs', 'status', 'detail'].includes(key)) && failure.phase === 'authorization' && (failure.status === undefined || (Number.isInteger(failure.status) && Number(failure.status) >= 400 && Number(failure.status) <= 599))) {
      try { return new InfrastructureError(infrastructureFailure(failure)) }
      catch { return new AuthorityError(text) }
    }
  }
  return new AuthorityError(text)
}
