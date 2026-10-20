import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

/**
 * A restored profile is older than the world outside (issue 1465): work it had claimed may have been finished and
 * external actions may have happened after the snapshot. Claims and pending approvals are held, open effects become
 * unknown, and a restore receipt keeps every Pod from resuming until the owner confirms the reconciliation.
 */
export function fenceRestoredRuntime(database: DatabaseSync, backupCreatedAt: string): void {
  const now = Date.now()
  for (const row of database.prepare('SELECT action_key,attempt FROM effect_attempts WHERE state=\'intent\'').all()) {
    const sequence = Number(database.prepare('SELECT coalesce(max(sequence),0)+1 AS next FROM effect_receipts WHERE action_key=? AND attempt=?').get(row.action_key, row.attempt)!.next)
    database.prepare('INSERT INTO effect_receipts VALUES(?,?,?,\'unknown\',?,?)').run(row.action_key, row.attempt, sequence, JSON.stringify({ reason: 'Restored backup: the outcome after the backup is unknown' }), now)
  }
  database.prepare('UPDATE effect_attempts SET state=\'unknown\' WHERE state=\'intent\'').run()
  database.prepare(`UPDATE action_approvals SET state='unknown',reason='Restored backup: the owner decision after the backup is unknown; request the approval again',updated_at=? WHERE state IN ('requested','approved')`).run(now)
  database.prepare('INSERT INTO storage_receipts VALUES(?,\'restore\',?,?)').run(randomUUID(), JSON.stringify({ backupCreatedAt, restoredAt: new Date(now).toISOString() }), now)
}

/** Activation stays refused while a restore is not reviewed; a temporary trigger, so backups never carry programs. */
export const restoreReviewGate = `CREATE TEMP TRIGGER restore_review_gate BEFORE UPDATE OF lifecycle ON pods
WHEN NEW.lifecycle='active' AND OLD.lifecycle<>'active' AND EXISTS(SELECT 1 FROM storage_receipts r WHERE r.kind='restore'
  AND NOT EXISTS(SELECT 1 FROM storage_receipts v WHERE v.kind='restore-reviewed' AND v.created_at>=r.created_at))
BEGIN SELECT RAISE(ABORT, 'Restored profile: confirm in Data & backups that external actions since the backup are checked before resuming Pods'); END`
