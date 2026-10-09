import { setTimeout as delay } from 'node:timers/promises'

export class AuthorityError extends Error {}
/** A failure that would repeat with the same input, so retrying the run cannot help. */
export class NonRetryableError extends Error {}

export interface InfrastructureFailure { phase: 'authorization' | 'read', retryAfterMs: number }
export class InfrastructureError extends Error {
  constructor(readonly failure: InfrastructureFailure) {
    super(failure.phase === 'authorization' ? 'Permission service temporarily unavailable' : 'HTTP service temporarily unavailable')
  }
}

export function infrastructureFailure(value: unknown): InfrastructureFailure {
  if (!value || typeof value !== 'object') throw new Error('Invalid infrastructure failure')
  const failure = value as InfrastructureFailure
  if (!['authorization', 'read'].includes(failure.phase) || !Number.isSafeInteger(failure.retryAfterMs) || failure.retryAfterMs < 0 || failure.retryAfterMs > 60000) throw new Error('Invalid infrastructure retry')
  return { phase: failure.phase, retryAfterMs: failure.retryAfterMs }
}

export function transientResponse(response: Response, phase: InfrastructureFailure['phase']): void {
  if (![408, 429, 500, 502, 503, 504].includes(response.status)) return
  const header = response.headers.get('retry-after')
  const seconds = header && /^\d+$/.test(header) ? Number(header) * 1000 : header ? Date.parse(header) - Date.now() : 0
  throw new InfrastructureError({ phase, retryAfterMs: Number.isFinite(seconds) ? Math.min(60000, Math.max(0, Math.ceil(seconds))) : 0 })
}

export function transientNetwork(error: unknown, phase: InfrastructureFailure['phase'], signal?: AbortSignal): never {
  signal?.throwIfAborted()
  const fault = error as { code?: string, name?: string, cause?: { code?: string } } | null
  const code = fault?.code ?? fault?.cause?.code
  if (fault?.name === 'TimeoutError' || (code && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET'].includes(code))) throw new InfrastructureError({ phase, retryAfterMs: 0 })
  throw error
}

export interface RetryNotice { attempt: number, nextAt: number, error: string }
export async function retryInfrastructure<T>(operation: () => Promise<T>, signal: AbortSignal, notice: (retry: RetryNotice | null) => void | Promise<void>, budgetMs = Infinity): Promise<T> {
  const started = Date.now()
  let attempt = 0
  for (;;) {
    signal.throwIfAborted()
    try {
      const result = await operation()
      if (attempt) await notice(null)
      return result
    }
    catch (error) {
      signal.throwIfAborted()
      if (!(error instanceof InfrastructureError)) throw error
      const wait = Math.max(error.failure.retryAfterMs, Math.min(60000, 2000 * 2 ** Math.min(attempt++, 5)))
      if (Date.now() - started + wait > budgetMs) throw error
      await notice({ attempt, nextAt: Date.now() + wait, error: error.message })
      await delay(wait, undefined, { signal })
    }
  }
}
