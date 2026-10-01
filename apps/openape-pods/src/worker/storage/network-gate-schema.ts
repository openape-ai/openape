export const networkGateSchema = `
CREATE TABLE network_gate_controls(
  task_id TEXT PRIMARY KEY REFERENCES network_gate_tasks(id),
  network_id TEXT NOT NULL,
  gate_key TEXT NOT NULL,
  summary TEXT NOT NULL CHECK(length(summary)<=4096),
  next_poll_at INTEGER NOT NULL,
  poll_count INTEGER NOT NULL DEFAULT 0 CHECK(poll_count>=0),
  pruned_status_count INTEGER NOT NULL DEFAULT 0 CHECK(pruned_status_count>=0),
  url TEXT CHECK(url IS NULL OR length(url)<=2048),
  error TEXT CHECK(error IS NULL OR length(error)<=10000),
  resolution TEXT CHECK(resolution IS NULL OR (json_valid(resolution) AND json_type(resolution)='object')),
  FOREIGN KEY(network_id,task_id) REFERENCES network_gate_tasks(network_id,id)
);
CREATE TABLE network_gate_attempt_controls(
  task_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('not_started','create','status','consume')),
  PRIMARY KEY(task_id,attempt),
  FOREIGN KEY(task_id,attempt) REFERENCES network_gate_task_attempts(task_id,attempt)
);
CREATE INDEX network_gate_pod_admission ON network_invocations(pod_id);
CREATE INDEX network_gate_due ON network_gate_controls(next_poll_at,task_id);
CREATE TABLE network_gate_items(
  task_id TEXT NOT NULL REFERENCES network_gate_tasks(id),
  delivery_id TEXT NOT NULL REFERENCES network_deliveries(id),
  event_id TEXT NOT NULL REFERENCES network_events(id),
  delivery_generation INTEGER NOT NULL CHECK(delivery_generation>=0),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  outcome TEXT NOT NULL CHECK(outcome IN ('held','released','excluded','denied','expired','obsolete','unknown')),
  receipt TEXT CHECK(receipt IS NULL OR (json_valid(receipt) AND json_type(receipt)='object')),
  PRIMARY KEY(task_id,delivery_id)
);
CREATE UNIQUE INDEX network_gate_item_held ON network_gate_items(delivery_id) WHERE outcome IN ('held','released','unknown');
`

export const networkGateTables = Array.from(networkGateSchema.matchAll(/CREATE TABLE (\w+)\(/g), match => match[1]!)
export const networkGateIndexes = Array.from(networkGateSchema.matchAll(/CREATE (?:UNIQUE )?INDEX (\w+)/g), match => match[1]!)
