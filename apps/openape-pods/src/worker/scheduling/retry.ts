import type { PodDatabase } from '../storage/database'

export function infrastructureRetry(store: PodDatabase, runId: string | null) {
  if (!runId) return null
  const row = store.db.prepare('SELECT i.reason,i.retry_at,i.retry_epoch,i.retry_attempt,r.script_hash,r.assignment_revision,r.error FROM run_inputs i JOIN runs r ON r.id=i.run_id WHERE i.run_id=? AND i.retry_at IS NOT NULL').get(runId)
  return row ? { reason: String(row.reason), at: Number(row.retry_at), epoch: Number(row.retry_epoch), attempt: Number(row.retry_attempt), script: String(row.script_hash), assignment: Number(row.assignment_revision), error: String(row.error) } : null
}

export function retryReady(store: PodDatabase, podId: string, runId: string | null, now: number, requireActive = true): boolean {
  const retry = infrastructureRetry(store, runId)
  if (!retry) return true
  const pod = store.getPod(podId)
  const epoch = store.db.prepare('SELECT epoch FROM resource_epochs WHERE pod_id=?').get(podId)?.epoch ?? 0
  if (pod.activeScript !== retry.script || pod.bindingRevision !== retry.assignment || epoch !== retry.epoch) throw new Error('Script or permissions changed during infrastructure retry; review before running')
  if (requireActive && retry.reason === 'schedule' && store.db.prepare('SELECT enabled FROM schedules WHERE pod_id=?').get(podId)?.enabled !== 1) return false
  return (!requireActive || pod.lifecycle === 'active') && retry.at <= now
}
