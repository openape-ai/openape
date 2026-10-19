export type RecoveryCause = 'failure' | 'infrastructure' | 'shutdown' | 'owner-cancelled' | 'authority' | 'permission' | 'non-retryable'
export interface RecoveryFailure { cause: RecoveryCause, retryAfterMs?: number }
export interface RecoveryDecision { disposition: 'retry' | 'isolated', reason: string, nextAt: number | null, attempt: number }
export class RunCancellation extends Error {
  constructor(readonly cause: RecoveryCause, message: string) { super(message) }
}
export const maximumRecoveryAttempts = 5
export function recoveryDecision(failure: RecoveryFailure, previousAttempts: number, now: number, maximumAttempts = maximumRecoveryAttempts): RecoveryDecision {
  const attempt = previousAttempts + 1
  if (failure.cause === 'permission' || failure.cause === 'authority') return { disposition: 'isolated', reason: 'Permission is unavailable; future schedules will check again', nextAt: null, attempt }
  if (failure.cause === 'non-retryable') return { disposition: 'isolated', reason: 'The same input would fail again; future schedules remain eligible', nextAt: null, attempt }
  if (failure.cause === 'owner-cancelled') return { disposition: 'isolated', reason: 'Attempt cancelled by the owner; future schedules remain eligible', nextAt: null, attempt }
  if (attempt >= maximumAttempts) return { disposition: 'isolated', reason: 'Automatic attempts exhausted; future schedules remain eligible', nextAt: null, attempt }
  const wait = Math.max(failure.retryAfterMs ?? 0, Math.min(60000, 2000 * 2 ** (attempt - 1)))
  return { disposition: 'retry', reason: 'Automatic retry scheduled', nextAt: now + wait, attempt }
}
