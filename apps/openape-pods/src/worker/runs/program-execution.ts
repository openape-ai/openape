import type { ProgramExecutionCheck } from '../../contracts/program-execution'
import { EffectLedger } from '../recovery/effects'
import type { PodDatabase } from '../storage/database'
import type { RunStore } from './store'

/** Called only after the existing run lease, resource epoch and pinned capabilities were checked. */
export function recordProgramExecution(store: PodDatabase, runs: RunStore, check: ProgramExecutionCheck): void {
  if (!/^[a-f0-9-]{36}$/.test(check.operationId)) throw new Error('Invalid program operation identity')
  const { podId, runId } = check.scope
  const key = `program:${runId}:${check.operationId}`
  const ledger = new EffectLedger(store)
  const record = check.record
  if (record.phase === 'authorized') {
    if (typeof record.write !== 'boolean') throw new Error('Invalid program effect classification')
    if (!record.write) { runs.append(runId, 'recovery-boundary', { kind: 'read', operation: 'tools.invoke' }); return }
    if (!ledger.begin(podId, runId, key, 'program.call', record.input).execute) throw new Error('This program operation already completed; it cannot execute again')
    return
  }
  const effect = store.db.prepare('SELECT run_id,state FROM effect_ledger WHERE pod_id=? AND effect_key=?').get(podId, key)
  if (effect?.run_id !== runId || effect.state !== 'intent') throw new Error('Program effect is not awaiting a receipt from this run')
  if (record.phase === 'completed') {
    if (!Number.isInteger(record.exitCode) || record.exitCode < 0 || record.exitCode > 255) throw new Error('Invalid program exit code')
    if (record.exitCode === 0) ledger.complete(podId, key, { exitCode: 0 })
    else ledger.markUnknown(podId, key)
    return
  }
  if (record.phase !== 'not-started' && record.phase !== 'unknown') throw new Error('Invalid program receipt')
  ledger.markUnknown(podId, key)
  if (record.phase === 'not-started') ledger.reconcile(podId, key, { applied: false })
}
