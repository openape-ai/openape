export const networkControlSchema = `
CREATE TABLE network_source_clocks(
  network_id TEXT NOT NULL,
  pod_id TEXT NOT NULL,
  next_at INTEGER NOT NULL,
  PRIMARY KEY(network_id,pod_id),
  FOREIGN KEY(network_id,pod_id) REFERENCES network_members(network_id,pod_id)
);
CREATE TABLE network_process_previews(
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL REFERENCES networks(id),
  preview TEXT NOT NULL CHECK(json_valid(preview) AND json_type(preview)='object'),
  fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  state TEXT NOT NULL DEFAULT 'preview' CHECK(state IN ('preview','running','stopped','finished')),
  remaining INTEGER NOT NULL CHECK(remaining BETWEEN 0 AND 100),
  started_sources TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(started_sources) AND json_type(started_sources)='array'),
  CHECK((state='preview')=(consumed_at IS NULL))
);
CREATE INDEX network_process_active ON network_process_previews(network_id,state,expires_at);
CREATE TABLE network_invocation_controls(
  run_id TEXT PRIMARY KEY REFERENCES network_invocations(run_id),
  trace_bytes INTEGER NOT NULL DEFAULT 0 CHECK(trace_bytes BETWEEN 0 AND 2097152),
  trace_count INTEGER NOT NULL DEFAULT 0 CHECK(trace_count BETWEEN 0 AND 1000),
  resolved_receipt TEXT CHECK(resolved_receipt IS NULL OR (json_valid(resolved_receipt) AND json_type(resolved_receipt)='object')),
  settlement_receipt TEXT CHECK(settlement_receipt IS NULL OR (json_valid(settlement_receipt) AND json_type(settlement_receipt)='object')),
  review_required INTEGER NOT NULL DEFAULT 0 CHECK(review_required IN (0,1)),
  snapshots TEXT CHECK(snapshots IS NULL OR (json_valid(snapshots) AND json_type(snapshots)='object')),
  deadline INTEGER,
  retry_of TEXT REFERENCES network_invocations(run_id),
  retry_at INTEGER,
  retry_consumed_at INTEGER,
  process_preview_id TEXT REFERENCES network_process_previews(id),
  creator_pid INTEGER CHECK(creator_pid IS NULL OR creator_pid>0),
  retry_authority TEXT CHECK(retry_authority IS NULL OR (json_valid(retry_authority) AND json_type(retry_authority)='object')),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK(attempt BETWEEN 1 AND 3),
  diagnostic TEXT CHECK(diagnostic IS NULL OR length(diagnostic)<=10000),
  failure_kind TEXT CHECK(failure_kind IN ('transient','invalid','uncertain','exhausted','timeout','quota','recovery')),
  stopped_receipt TEXT CHECK(stopped_receipt IS NULL OR json_valid(stopped_receipt))
);
CREATE INDEX network_control_retry ON network_invocation_controls(retry_at,run_id) WHERE retry_at IS NOT NULL;
CREATE INDEX network_control_deadline ON network_invocation_controls(deadline,run_id) WHERE deadline IS NOT NULL;
CREATE INDEX network_control_pending_age ON network_deliveries(network_id,state,accepted_at);
CREATE INDEX network_control_invocation_state ON network_invocations(pod_id,state,run_id);
CREATE INDEX network_control_invocation_health ON network_invocations(network_id,state,run_id);
CREATE TABLE network_trace_history(
  network_id TEXT NOT NULL REFERENCES networks(id),
  day INTEGER NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL CHECK(count>0),
  PRIMARY KEY(network_id,day,kind)
);
CREATE TABLE network_scheduler_state(
  id INTEGER PRIMARY KEY CHECK(id=1),
  next_domain INTEGER NOT NULL DEFAULT 0 CHECK(next_domain BETWEEN 0 AND 2),
  last_network TEXT,
  last_progress_at INTEGER,
  last_error_domain INTEGER CHECK(last_error_domain BETWEEN 0 AND 2),
  last_error TEXT
);
CREATE TABLE network_runtime_status(
  network_id TEXT PRIMARY KEY REFERENCES networks(id),
  last_pod TEXT,
  last_dispatch_at INTEGER,
  intake_error TEXT,
  inspected_at INTEGER
);
`

export const networkControlIndexes = Array.from(networkControlSchema.matchAll(/CREATE INDEX (\w+)/g), match => match[1]!)

export const networkControlTables = Array.from(networkControlSchema.matchAll(/CREATE TABLE (\w+)\(/g), match => match[1]!)

export const migrateNetworkControls = `
INSERT INTO network_invocation_controls(run_id,review_required,snapshots)
SELECT run_id,coalesce(json_extract(manifest,'$.reviewRequired'),0),json_extract(manifest,'$.snapshots') FROM network_invocations;
INSERT INTO network_source_clocks(network_id,pod_id,next_at)
SELECT t.network_id,json_extract(s.value,'$.podId'),coalesce(
  (SELECT json_extract(i.manifest,'$.sourceNextAt') FROM network_invocations i JOIN runs r ON r.id=i.run_id
   WHERE i.network_id=t.network_id AND i.pod_id=json_extract(s.value,'$.podId') AND json_extract(i.manifest,'$.sourceActivationId')=t.id
   ORDER BY r.started_at DESC,r.rowid DESC LIMIT 1),json_extract(s.value,'$.nextAt'))
FROM network_trace_events t,json_each(t.body,'$.sources') s
WHERE EXISTS(SELECT 1 FROM networks n WHERE n.id=t.network_id AND n.baseline_state='ready') AND t.kind='network-activated' AND t.id=(SELECT max(a.id) FROM network_trace_events a WHERE a.network_id=t.network_id AND a.kind='network-activated');
INSERT INTO network_process_previews(id,network_id,preview,fingerprint,expires_at,consumed_at,state,remaining)
SELECT json_extract(t.body,'$.preview.id'),t.network_id,json_extract(t.body,'$.preview'),json_extract(t.body,'$.fingerprint'),
 json_extract(t.body,'$.preview.expiresAt'),
 CASE WHEN EXISTS(SELECT 1 FROM networks n WHERE n.id=t.network_id AND n.baseline_state!='ready') THEN 0
 ELSE (SELECT min(a.created_at) FROM network_trace_events a WHERE a.network_id=t.network_id AND a.kind='process-now-started' AND json_extract(a.body,'$.previewId')=json_extract(t.body,'$.preview.id')) END,
 CASE WHEN EXISTS(SELECT 1 FROM networks n WHERE n.id=t.network_id AND n.baseline_state!='ready')
 OR EXISTS(SELECT 1 FROM network_trace_events a WHERE a.network_id=t.network_id AND a.kind='process-now-started' AND json_extract(a.body,'$.previewId')=json_extract(t.body,'$.preview.id')) THEN 'stopped' ELSE 'preview' END,
 json_extract(t.body,'$.preview.budget')
FROM network_trace_events t WHERE t.kind='process-now-preview';
`

export const migrateNetworkSettlements = `
UPDATE network_invocation_controls SET settlement_receipt=(
 SELECT body FROM network_trace_events t WHERE t.run_id=network_invocation_controls.run_id AND t.kind='invocation-settled' ORDER BY t.id DESC LIMIT 1
);
`
