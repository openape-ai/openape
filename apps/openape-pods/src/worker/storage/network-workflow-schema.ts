export const networkWorkflowSchema = `
CREATE TABLE workflow_call_staging(
  run_id TEXT NOT NULL REFERENCES network_invocations(run_id),
  request_id TEXT NOT NULL,
  logical_key TEXT NOT NULL CHECK(length(logical_key)=64),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  request TEXT NOT NULL CHECK(json_valid(request)),
  restore_nonce TEXT NOT NULL,
  activation_epoch INTEGER NOT NULL,
  PRIMARY KEY(run_id,request_id),
  UNIQUE(run_id,logical_key)
);
CREATE TABLE workflow_call_permissions(
  workflow_id TEXT NOT NULL,
  workflow_revision INTEGER NOT NULL,
  network_id TEXT NOT NULL,
  pod_id TEXT NOT NULL,
  owner_issuer TEXT NOT NULL,
  owner_subject TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES pod_groups(id),
  revision INTEGER NOT NULL CHECK(revision>0),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  PRIMARY KEY(workflow_id,workflow_revision,network_id,pod_id),
  FOREIGN KEY(workflow_id,workflow_revision) REFERENCES workflow_revisions(workflow_id,revision),
  FOREIGN KEY(network_id,pod_id) REFERENCES network_members(network_id,pod_id),
  FOREIGN KEY(owner_issuer,owner_subject) REFERENCES network_owners(issuer,subject)
);
CREATE TABLE workflow_call_controls(
  request_id TEXT PRIMARY KEY REFERENCES workflow_call_requests(id),
  logical_key TEXT NOT NULL UNIQUE CHECK(length(logical_key)=64),
  permission_revision INTEGER NOT NULL CHECK(permission_revision>0),
  restore_nonce TEXT NOT NULL,
  activation_epoch INTEGER NOT NULL,
  diagnostic TEXT,
  delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK(delivery_state IN ('pending','delivered','blocked')),
  terminal_event_id TEXT UNIQUE REFERENCES network_events(id),
  cancellation_receipt TEXT CHECK(cancellation_receipt IS NULL OR json_valid(cancellation_receipt)),
  next_gate_poll_at INTEGER NOT NULL DEFAULT 0 CHECK(next_gate_poll_at>=0),
  next_delivery_poll_at INTEGER NOT NULL DEFAULT 0 CHECK(next_delivery_poll_at>=0)
);
CREATE TABLE workflow_gate_attempts(
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  request_id TEXT NOT NULL REFERENCES workflow_call_requests(id),
  gates TEXT NOT NULL CHECK(json_valid(gates) AND json_type(gates)='array'),
  created_at INTEGER NOT NULL
);
CREATE TABLE workflow_gate_poll_clocks(
  request_id TEXT NOT NULL REFERENCES workflow_call_requests(id),
  pod_id TEXT NOT NULL REFERENCES pods(id),
  next_poll_at INTEGER NOT NULL CHECK(next_poll_at>=0),
  PRIMARY KEY(request_id,pod_id)
);
CREATE TABLE workflow_call_result_events(
  request_id TEXT NOT NULL REFERENCES workflow_call_requests(id),
  port_name TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE REFERENCES network_events(id),
  PRIMARY KEY(request_id,port_name)
);
CREATE INDEX workflow_call_state ON workflow_call_requests(state,workflow_id);
CREATE INDEX workflow_call_execution ON workflow_call_requests(workflow_run_id);
CREATE INDEX workflow_call_delivery ON workflow_call_controls(delivery_state,next_delivery_poll_at,request_id);`

export const networkWorkflowTables = ['workflow_call_staging', 'workflow_call_permissions', 'workflow_call_controls', 'workflow_gate_attempts', 'workflow_gate_poll_clocks', 'workflow_call_result_events']
export const networkWorkflowIndexes = ['workflow_call_state', 'workflow_call_execution', 'workflow_call_delivery']
