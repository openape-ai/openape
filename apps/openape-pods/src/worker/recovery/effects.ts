import { digest } from '../storage/database'
import type { PodDatabase } from '../storage/database'

export class EffectLedger {
  constructor(private readonly store: PodDatabase) {}

  begin(podId: string, runId: string, key: string, operation: string, input: unknown): { execute: boolean, result?: unknown } {
    if (!/^[\w.:-]{1,160}$/.test(key) || !/^[a-z][a-z0-9.-]{1,100}$/.test(operation)) throw new Error('Invalid effect identity')
    const serialized = JSON.stringify(input)
    // Only the input hash is stored, so the bound follows the largest accepted HTTP request.
    if (!serialized || Buffer.byteLength(serialized) > 128 * 1024) throw new Error('Invalid effect input')
    const hash = digest(serialized)
    return this.store.transaction(() => {
      const run = this.store.db.prepare('SELECT pod_id,state FROM runs WHERE id=?').get(runId)
      if (run?.pod_id !== podId || run.state !== 'running') throw new Error('Effect requires an active owning run')
      const existing = this.store.db.prepare('SELECT * FROM effect_ledger WHERE pod_id=? AND effect_key=?').get(podId, key)
      if (existing) {
        if (existing.operation !== operation || existing.input_hash !== hash) throw new Error('Idempotency key has conflicting effect input')
        if (existing.state === 'completed') return { execute: false, result: JSON.parse(existing.result as string) }
        if (existing.state === 'intent' && existing.run_id === runId) throw new Error('Effect is already being sent by this run')
        // Worker start turns every intent into unknown, so a live intent is a request still in flight.
        if (existing.state === 'intent') throw new Error('Effect is still being sent by an earlier run')
      }
      // An uncertain earlier outcome never refuses its key: the effect is sent again and the script owns idempotency.
      this.store.db.prepare('INSERT INTO effect_ledger VALUES(?,?,?,?,?,\'intent\',NULL) ON CONFLICT(pod_id,effect_key) DO UPDATE SET run_id=excluded.run_id,state=\'intent\',result=NULL').run(podId, key, operation, hash, runId)
      return { execute: true }
    })
  }

  complete(podId: string, runId: string, key: string, result: unknown): void {
    const body = JSON.stringify(result)
    if (!body || Buffer.byteLength(body) > 32768) throw new Error('Invalid effect result')
    const updated = this.store.db.prepare('UPDATE effect_ledger SET state=\'completed\',result=? WHERE pod_id=? AND run_id=? AND effect_key=? AND state=\'intent\'').run(body, podId, runId, key)
    if (updated.changes !== 1) throw new Error('Effect is not awaiting completion')
  }

  /** The trusted broker confirmed an authorization failure before request dispatch. */
  notStarted(podId: string, runId: string, key: string): void {
    const removed = this.store.db.prepare('DELETE FROM effect_ledger WHERE pod_id=? AND run_id=? AND effect_key=? AND state=\'intent\'').run(podId, runId, key)
    if (removed.changes !== 1) throw new Error('Effect is not awaiting dispatch')
  }

  markUnknown(podId: string, runId: string, key: string): void {
    const updated = this.store.db.prepare('UPDATE effect_ledger SET state=\'unknown\' WHERE pod_id=? AND run_id=? AND effect_key=? AND state=\'intent\'').run(podId, runId, key)
    if (updated.changes !== 1) throw new Error('Effect is not awaiting completion')
  }
}
