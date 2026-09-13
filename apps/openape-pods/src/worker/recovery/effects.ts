import { digest } from '../storage/database'
import type { PodDatabase } from '../storage/database'

export class EffectLedger {
  constructor(private readonly store: PodDatabase) {}

  begin(podId: string, runId: string, key: string, operation: string, input: unknown): { execute: boolean, result?: unknown } {
    if (!/^[\w.:-]{1,160}$/.test(key) || !/^[a-z][a-z0-9.-]{1,100}$/.test(operation)) throw new Error('Invalid effect identity')
    const serialized = JSON.stringify(input)
    if (!serialized || Buffer.byteLength(serialized) > 32768) throw new Error('Invalid effect input')
    const hash = digest(serialized)
    return this.store.transaction(() => {
      const run = this.store.db.prepare('SELECT pod_id,state FROM runs WHERE id=?').get(runId)
      if (run?.pod_id !== podId || run.state !== 'running') throw new Error('Effect requires an active owning run')
      const existing = this.store.db.prepare('SELECT * FROM effect_ledger WHERE pod_id=? AND effect_key=?').get(podId, key)
      if (existing) {
        if (existing.operation !== operation || existing.input_hash !== hash) throw new Error('Idempotency key has conflicting effect input')
        if (existing.state === 'completed') return { execute: false, result: JSON.parse(existing.result as string) }
        throw new Error('Effect outcome is unknown; reconcile before retrying')
      }
      this.store.db.prepare('INSERT INTO effect_ledger VALUES(?,?,?,?,?,\'intent\',NULL)').run(podId, key, operation, hash, runId)
      return { execute: true }
    })
  }

  complete(podId: string, key: string, result: unknown): void {
    const body = JSON.stringify(result)
    if (!body || Buffer.byteLength(body) > 32768) throw new Error('Invalid effect result')
    const updated = this.store.db.prepare('UPDATE effect_ledger SET state=\'completed\',result=? WHERE pod_id=? AND effect_key=? AND state=\'intent\'').run(body, podId, key)
    if (updated.changes !== 1) throw new Error('Effect is not awaiting completion')
  }

  reconcile(podId: string, key: string, outcome: { applied: true, result: unknown } | { applied: false }): void {
    const record = this.store.db.prepare('SELECT state FROM effect_ledger WHERE pod_id=? AND effect_key=?').get(podId, key)
    if (!record || record.state !== 'unknown') throw new Error('Effect is not awaiting reconciliation')
    if (!outcome.applied) { this.store.db.prepare('DELETE FROM effect_ledger WHERE pod_id=? AND effect_key=? AND state=\'unknown\'').run(podId, key); return }
    const body = JSON.stringify(outcome.result)
    if (!body || Buffer.byteLength(body) > 32768) throw new Error('Invalid reconciliation evidence')
    this.store.db.prepare('UPDATE effect_ledger SET state=\'completed\',result=? WHERE pod_id=? AND effect_key=? AND state=\'unknown\'').run(body, podId, key)
  }
}
