import type { H3Event } from 'h3'
import { createError, isError, setResponseHeader } from 'h3'
import { createProblemDetails } from '@openape/core'

export function createProblemError(opts: {
  type?: string
  title: string
  status: number
  detail?: string
  /** Seconds a rate-limited caller should wait; relayed as `Retry-After` by `relayRetryAfter`. */
  retryAfter?: number
}) {
  const { retryAfter, ...problem } = opts
  return createError({
    statusCode: opts.status,
    statusMessage: opts.title,
    data: { ...createProblemDetails(problem), ...(retryAfter === undefined ? {} : { retry_after: retryAfter }) },
  })
}

/** Sets `Retry-After` for a rate-limit error that carries `retry_after` in its data. */
export function relayRetryAfter(event: H3Event, error: unknown): void {
  if (!isError(error) || error.statusCode !== 429) return
  const seconds = (error.data as Record<string, unknown> | undefined)?.retry_after
  if (Number.isInteger(seconds) && (seconds as number) > 0) setResponseHeader(event, 'Retry-After', seconds as number)
}
