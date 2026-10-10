import type { PodDatabase } from '../storage/database'

export type RecoveryCause = 'failure' | 'infrastructure' | 'shutdown' | 'owner-cancelled' | 'authority' | 'non-retryable'
export interface RecoveryFailure { cause: RecoveryCause, retryAfterMs?: number }
export interface RecoveryDecision { disposition: 'retry' | 'isolated' | 'hold', reason: string, nextAt: number | null, attempt: number }
export class RunCancellation extends Error {
  constructor(readonly cause: RecoveryCause, message: string) { super(message) }
}
export const maximumRecoveryAttempts = 5
export function recoveryDecision(failure: RecoveryFailure, previousAttempts: number, hold: string | null, now: number, maximumAttempts = maximumRecoveryAttempts): RecoveryDecision {
  const attempt = previousAttempts + 1
  if (hold) return { disposition: 'hold', reason: hold, nextAt: null, attempt }
  if (failure.cause === 'authority') return { disposition: 'hold', reason: 'Execution permission requires owner review', nextAt: null, attempt }
  if (failure.cause === 'non-retryable') return { disposition: 'isolated', reason: 'The same input would fail again; future schedules remain eligible', nextAt: null, attempt }
  if (failure.cause === 'owner-cancelled') return { disposition: 'isolated', reason: 'Attempt cancelled by the owner; future schedules remain eligible', nextAt: null, attempt }
  if (attempt >= maximumAttempts) return { disposition: 'isolated', reason: 'Automatic attempts exhausted; future schedules remain eligible', nextAt: null, attempt }
  const wait = Math.max(failure.retryAfterMs ?? 0, Math.min(60000, 2000 * 2 ** (attempt - 1)))
  return { disposition: 'retry', reason: 'Automatic retry scheduled', nextAt: now + wait, attempt }
}

export function recoveryHold(store: PodDatabase, podId: string, runId?: string): string | null {
  const effect = store.db.prepare('SELECT operation,effect_key FROM effect_ledger WHERE pod_id=? AND state IN (\'intent\',\'unknown\') LIMIT 1').get(podId)
  if (effect) return `External outcome requires review: ${effect.operation} (${effect.effect_key})`
  if (store.db.prepare('SELECT 1 FROM graph_gate_batches WHERE pod_id=? AND state IN (\'consuming\',\'unknown\') LIMIT 1').get(podId)) return 'An approval action has an unresolved outcome'
  if (runId && store.db.prepare('SELECT 1 FROM run_events WHERE run_id=? AND type=\'approval\' AND json_extract(data,\'$.state\') IN (\'denied\',\'revoked\') LIMIT 1').get(runId)) return 'Execution permission was refused or revoked; review before retrying'
  // A run that sent an HTTP write or ran an application write is never replayed automatically; the owner reviews it.
  if (runId && store.db.prepare('SELECT 1 FROM effect_ledger WHERE run_id=? LIMIT 1').get(runId)) return 'This run already wrote externally; review its effects before retrying'
  if (unresolvedOperation(store, podId)) return 'An operation without replay evidence requires review'
  return null
}

export function unresolvedOperation(store: PodDatabase, podId: string): boolean {
  return !!store.db.prepare(`SELECT 1 FROM runs r JOIN run_events e ON e.run_id=r.id
    WHERE r.pod_id=? AND e.type='recovery-boundary' AND json_extract(e.data,'$.kind')='untracked'
      AND NOT EXISTS(SELECT 1 FROM run_events settled WHERE settled.run_id=e.run_id
        AND settled.type='recovery-boundary-result' AND json_extract(settled.data,'$.id')=json_extract(e.data,'$.id')) LIMIT 1`).get(podId)
}
