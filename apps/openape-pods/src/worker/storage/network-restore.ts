import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { assertNetworkStorage } from './network-schema.ts'

export function restoreNetworkStorage(database: DatabaseSync): void {
  assertNetworkStorage(database, true)
  for (const network of database.prepare('SELECT id,state FROM networks').all()) {
    database.prepare('UPDATE networks SET state=CASE WHEN state=\'archived\' THEN \'archived\' ELSE \'paused\' END,activation_epoch=activation_epoch+1,restore_nonce=?,baseline_state=\'review_required\',baseline_receipt=NULL WHERE id=?').run(randomUUID(), network.id)
    const counts = database.prepare('SELECT count(*) AS total,sum(staged_checkpoint IS NOT NULL) AS staged FROM network_invocations WHERE network_id=?').get(network.id)!
    database.prepare('INSERT INTO network_trace_events(network_id,kind,body,created_at) VALUES(?,\'restore_authority_revoked\',?,?)').run(network.id, JSON.stringify({ reason: 'Restored backup: baseline and effect review required', previousState: network.state, invocationsRevoked: counts.total, stagedCheckpointsRetained: counts.staged ?? 0 }), Date.now())
  }
  for (const effect of database.prepare('SELECT logical_action_key,attempt FROM network_effect_attempts WHERE state=\'intent\'').all()) {
    const sequence = Number(database.prepare('SELECT max(sequence) AS sequence FROM network_effect_receipts WHERE logical_action_key=? AND attempt=?').get(effect.logical_action_key, effect.attempt)?.sequence ?? 0) + 1
    database.prepare('INSERT INTO network_effect_receipts VALUES(?,?,?,\'unknown\',?,?)').run(effect.logical_action_key, effect.attempt, sequence, JSON.stringify({ reason: 'Restored backup: effect requires reconciliation' }), Date.now())
  }
  database.exec(`
UPDATE network_effect_attempts SET state='unknown' WHERE state='intent';
UPDATE network_gate_task_attempts SET state='unknown' WHERE state='running';
UPDATE network_deliveries SET state=CASE WHEN state='unknown' OR EXISTS(SELECT 1 FROM network_invocations i WHERE i.run_id=network_deliveries.run_id AND i.state='unknown') OR EXISTS(SELECT 1 FROM network_effect_attempts e WHERE e.run_id=network_deliveries.run_id AND e.state IN ('intent','unknown')) OR EXISTS(SELECT 1 FROM network_gate_task_attempts a WHERE a.run_id=network_deliveries.run_id AND a.state='unknown') THEN 'unknown' ELSE 'blocked' END,generation=generation+1,claim_token=NULL,boot_nonce=NULL,reason=coalesce(reason,'Restored backup: review baseline and effects before retry') WHERE state IN ('pending','claimed','retry_wait','blocked','unknown');
UPDATE network_invocations SET state=CASE WHEN state='unknown' OR EXISTS(SELECT 1 FROM network_effect_attempts e WHERE e.run_id=network_invocations.run_id AND e.state='unknown') OR EXISTS(SELECT 1 FROM network_gate_task_attempts a WHERE a.run_id=network_invocations.run_id AND a.state='unknown') THEN 'unknown' ELSE 'blocked' END WHERE state IN ('running','stopping','interrupted','blocked','unknown');
UPDATE network_gate_tasks SET state=CASE WHEN state='consuming' OR grant_id IS NOT NULL OR EXISTS(SELECT 1 FROM network_gate_task_attempts a WHERE a.task_id=network_gate_tasks.id AND a.state='unknown') THEN 'unknown' ELSE 'superseded' END,generation=generation+1 WHERE state IN ('preparing','pending','consuming');
UPDATE network_joins SET state='blocked',reason=coalesce(reason,'Restored backup: join requires review') WHERE state='pending';
DELETE FROM network_queue_counts;
INSERT INTO network_queue_counts SELECT network_id,state,count(*) FROM network_deliveries GROUP BY network_id,state;
`)
  if (Number(database.prepare('PRAGMA user_version').get()!.user_version) >= 29) {
    database.exec('UPDATE network_process_previews SET consumed_at=coalesce(consumed_at,0),state=\'stopped\'; DELETE FROM network_source_clocks; UPDATE network_invocation_controls SET deadline=NULL,retry_at=NULL,retry_authority=NULL; UPDATE network_scheduler_state SET next_domain=0,last_network=NULL,last_progress_at=NULL,last_error_domain=NULL,last_error=NULL; DELETE FROM network_runtime_status;')
  }
  if (Number(database.prepare('PRAGMA user_version').get()!.user_version) >= 30) {
    database.exec(`UPDATE network_gate_tasks SET state='superseded',generation=generation+1 WHERE state='approved' AND NOT EXISTS(SELECT 1 FROM networks n WHERE n.id=network_gate_tasks.network_id AND n.state='archived') AND EXISTS(SELECT 1 FROM network_gate_controls control WHERE control.task_id=network_gate_tasks.id);
UPDATE network_gate_items SET outcome=CASE WHEN EXISTS(SELECT 1 FROM network_gate_tasks task WHERE task.id=network_gate_items.task_id AND task.state='unknown') THEN 'unknown' ELSE 'obsolete' END,receipt=json_object('kind','restore-gate-authority-revoked','at',unixepoch()*1000,'priorReceipt',json(receipt)) WHERE outcome IN ('held','released') AND NOT EXISTS(SELECT 1 FROM network_gate_tasks task JOIN networks n ON n.id=task.network_id WHERE task.id=network_gate_items.task_id AND n.state='archived');
UPDATE network_deliveries SET state='unknown' WHERE state='blocked' AND EXISTS(SELECT 1 FROM network_gate_items item JOIN network_gate_tasks task ON task.id=item.task_id WHERE item.delivery_id=network_deliveries.id AND item.outcome='unknown' AND task.state='unknown');
DELETE FROM network_queue_counts; INSERT INTO network_queue_counts SELECT network_id,state,count(*) FROM network_deliveries GROUP BY network_id,state;
UPDATE network_gate_controls SET next_poll_at=0,error=coalesce(error,'Restored gate authority revoked; review baseline, grant outcome and exact inputs before proceeding') WHERE NOT EXISTS(SELECT 1 FROM network_gate_tasks task JOIN networks n ON n.id=task.network_id WHERE task.id=network_gate_controls.task_id AND n.state='archived') AND EXISTS(SELECT 1 FROM network_gate_items item WHERE item.task_id=network_gate_controls.task_id AND json_extract(item.receipt,'$.kind')='restore-gate-authority-revoked');`)
  }
  for (const invocation of database.prepare('SELECT run_id FROM network_invocations').all()) {
    database.prepare('UPDATE network_invocations SET claim_token=?,boot_nonce=?,restore_nonce=(SELECT restore_nonce FROM networks WHERE id=network_id),generation=generation+1 WHERE run_id=?').run(randomUUID(), randomUUID(), invocation.run_id)
  }
  for (const attempt of database.prepare('SELECT task_id,attempt FROM network_gate_task_attempts').all()) {
    database.prepare('UPDATE network_gate_task_attempts SET step_token=?,generation=generation+1 WHERE task_id=? AND attempt=?').run(randomUUID(), attempt.task_id, attempt.attempt)
  }
  assertNetworkStorage(database, true)
}
