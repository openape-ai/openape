/** Retired schema-53 tables, used only to convert older profiles. */
export const schema53Shared = `
-- Shared domain data, work, owner questions, approvals and effects (issue 1465)
CREATE TABLE data_namespaces(
  path TEXT PRIMARY KEY CHECK(length(path) BETWEEN 1 AND 200),
  writer TEXT NOT NULL CHECK(length(writer) BETWEEN 1 AND 64),
  mode TEXT NOT NULL CHECK(mode IN ('records','results')),
  schema TEXT CHECK(schema IS NULL OR (json_valid(schema) AND json_type(schema)='object')),
  writer_epoch INTEGER NOT NULL CHECK(writer_epoch>0),
  revision INTEGER NOT NULL CHECK(revision>0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE data_readers(
  path TEXT NOT NULL REFERENCES data_namespaces(path),
  pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE,
  PRIMARY KEY(path,pod_id)
);
CREATE TABLE data_sequence(id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL CHECK(value>=0));
CREATE TABLE data_entries(
  namespace TEXT NOT NULL REFERENCES data_namespaces(path),
  key TEXT NOT NULL CHECK(length(key) BETWEEN 1 AND 300),
  revision INTEGER NOT NULL CHECK(revision>0),
  sequence INTEGER NOT NULL UNIQUE,
  value TEXT CHECK(value IS NULL OR json_valid(value)),
  deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),
  digest TEXT NOT NULL CHECK(length(digest)=64),
  author TEXT NOT NULL,
  run_id TEXT,
  writer_epoch INTEGER NOT NULL,
  result TEXT CHECK(result IS NULL OR (json_valid(result) AND json_type(result)='object')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(namespace,key),
  CHECK((deleted=1 AND value IS NULL) OR (deleted=0 AND value IS NOT NULL))
);
CREATE INDEX data_entry_changes ON data_entries(namespace,sequence);
CREATE TABLE data_entry_revisions(
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  value TEXT CHECK(value IS NULL OR json_valid(value)),
  deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),
  digest TEXT NOT NULL,
  author TEXT NOT NULL,
  run_id TEXT,
  result TEXT CHECK(result IS NULL OR json_valid(result)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(namespace,key,revision)
);
CREATE TABLE work_operations(
  operation TEXT PRIMARY KEY CHECK(length(operation) BETWEEN 1 AND 120),
  input TEXT NOT NULL REFERENCES data_namespaces(path),
  output TEXT NOT NULL REFERENCES data_namespaces(path),
  fields TEXT NOT NULL CHECK(json_valid(fields) AND json_type(fields)='array'),
  filter TEXT NOT NULL CHECK(json_valid(filter) AND json_type(filter)='object'),
  rule_version INTEGER NOT NULL CHECK(rule_version>0),
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0),
  cursor INTEGER NOT NULL DEFAULT 0 CHECK(cursor>=0),
  updated_at INTEGER NOT NULL
);
CREATE TABLE work_items(
  key TEXT PRIMARY KEY CHECK(length(key)=64),
  operation TEXT NOT NULL REFERENCES work_operations(operation),
  object TEXT NOT NULL,
  input_revision INTEGER NOT NULL CHECK(input_revision>0),
  fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64),
  rule_version INTEGER NOT NULL CHECK(rule_version>0),
  generation INTEGER NOT NULL CHECK(generation>=0),
  state TEXT NOT NULL CHECK(state IN ('ready','claimed','completed','retry_wait','waiting','blocked','unknown','superseded')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt>=0),
  lease INTEGER NOT NULL DEFAULT 0 CHECK(lease>=0),
  claim_token TEXT,
  run_id TEXT,
  pod_id TEXT,
  ready_at INTEGER NOT NULL,
  reason TEXT CHECK(reason IS NULL OR length(reason)<=2000),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(state!='claimed' OR (claim_token IS NOT NULL AND run_id IS NOT NULL AND lease>0))
);
CREATE INDEX work_queue ON work_items(operation,state,ready_at,created_at);
CREATE INDEX work_object ON work_items(operation,object,state);
CREATE INDEX work_run ON work_items(run_id) WHERE run_id IS NOT NULL;
CREATE TABLE owner_questions(
  id TEXT PRIMARY KEY,
  pod_id TEXT NOT NULL,
  namespace TEXT NOT NULL REFERENCES data_namespaces(path),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL CHECK(length(fingerprint) BETWEEN 1 AND 128),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 300),
  body TEXT NOT NULL CHECK(length(body)<=4000),
  options TEXT NOT NULL CHECK(json_valid(options) AND json_type(options)='array'),
  data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data)='object'),
  state TEXT NOT NULL CHECK(state IN ('pending','decided','superseded','withdrawn')),
  option TEXT,
  decided_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(namespace,key,fingerprint),
  CHECK((state='decided')=(option IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE INDEX owner_questions_open ON owner_questions(state,created_at);
`
