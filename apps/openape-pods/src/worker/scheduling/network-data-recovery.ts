import type { PodDatabase } from '../storage/database'
import { digest } from '../storage/database'
import { canonicalNetworkJson } from '../../contracts/network-json'

export function abandonNetworkData(store: PodDatabase, runId: string, decision: 'owner-retry' | 'owner-discard' | 'owner-gate-review'): void {
  const writes = store.db.prepare('SELECT collection_id,record_key,base_revision,revision,body,tombstone,artifact_refs FROM network_data_staging WHERE run_id=? ORDER BY collection_id,record_key,revision').all(runId)
  const artifacts = store.db.prepare('SELECT id,scope_id,content_hash,size FROM network_artifact_staging WHERE run_id=? ORDER BY id').all(runId)
  if (!writes.length && !artifacts.length) return
  const invocation = store.db.prepare('SELECT network_id FROM network_invocations WHERE run_id=?').get(runId)!
  const evidence = { decision, uncommittedOnly: true, automaticReplayPermitted: false, writes: writes.map(({ body, ...write }) => ({ ...write, bodyHash: body === null ? null : digest(body as string) })), artifacts }
  store.db.prepare('INSERT INTO network_trace_events(network_id,run_id,kind,body,created_at) VALUES(?,?,\'staged-data-abandoned\',?,?)').run(invocation.network_id!, runId, canonicalNetworkJson(evidence), Date.now())
  store.db.prepare('DELETE FROM network_data_staging WHERE run_id=?').run(runId)
  store.db.prepare('DELETE FROM network_artifact_staging WHERE run_id=?').run(runId)
}
