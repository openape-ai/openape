import { createError } from 'h3'

export function recoveryUnavailable(phase: string, causeCode: string, cause: unknown) {
  return createError({
    statusCode: 503,
    statusMessage: 'Reports independent commit failed; serving is fenced until authoritative reconciliation',
    data: {
      type: 'urn:openape:problem:reports-recovery-unavailable',
      status: 503,
      title: 'Reports recovery requires reconciliation',
      detail: 'Independent commit failed; serving is fenced. Reconcile the authoritative state before restarting the writer.',
      operation: 'reports-recovery',
      phase,
      cause: causeCode,
    },
    cause,
  })
}
