import type { DatabaseSync } from 'node:sqlite'

/**
 * Schema 43 (issue 1455, M4): networks are the only orchestration model. Every remaining workflow is archived,
 * and so is every Pod that only workflows used: no network member and no own enabled schedule. Workflow history
 * is detached from Pods, runs and networks, so retention and deletion never need the workflow tables again.
 * The tables themselves stay until the baseline schema (M8); the pre-upgrade backup keeps every row.
 */
export function retireWorkflows(database: DatabaseSync, now: number): void {
  database.prepare(`UPDATE pods SET lifecycle='archived',metadata_revision=metadata_revision+1
    WHERE lifecycle!='archived'
      AND id IN (SELECT m.pod_id FROM workflow_members m JOIN workflows w ON w.id=m.workflow_id WHERE w.archived=0
        UNION SELECT json_extract(node.value,'$.podId') FROM workflows w, json_each(w.nodes) node WHERE w.archived=0)
      AND id NOT IN (SELECT pod_id FROM network_members)
      AND id NOT IN (SELECT pod_id FROM schedules WHERE enabled=1)`).run()
  database.exec('UPDATE workflows SET archived=1,enabled=0,paused=1,next_at=NULL WHERE archived=0')
  database.prepare('UPDATE workflow_runs SET state=\'cancelled\',reason=\'Workflows were retired; networks replace them\',finished_at=? WHERE finished_at IS NULL').run(now)
  database.exec(`
DELETE FROM workflow_call_result_events;
DELETE FROM workflow_call_controls;
DELETE FROM workflow_call_staging;
DELETE FROM workflow_gate_poll_clocks;
DELETE FROM workflow_gate_attempts;
DELETE FROM workflow_call_requests;
DELETE FROM workflow_call_permissions;
DELETE FROM workflow_reservations;
DELETE FROM workflow_attempts;
DELETE FROM workflow_nodes;
DELETE FROM workflow_members;
UPDATE network_scheduler_state SET next_domain=0,last_error_domain=NULL,last_error=NULL;`)
}
