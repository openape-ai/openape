/**
 * The complete control database of schema 48 (issue 1465): Pods, scripts, runs and grants, and the shared domain data,
 * work ledger, owner questions, object approvals and external effects of autonomous Pods. A fresh profile is created
 * from it; convert.ts converts schema-46 and schema-47 profiles and backups, archiving every row of the retired network
 * runtime in legacy_records. Older profiles and backups are refused.
 */
export const schemaVersion = 48

export const baselineSchema = `
-- Pods, scripts and knowledge
CREATE TABLE pods(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  lifecycle TEXT NOT NULL DEFAULT 'paused' CHECK(lifecycle IN ('active','paused','archived')),
  active_script TEXT,
  metadata_revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE scripts(
  pod_id TEXT NOT NULL REFERENCES pods(id),
  hash TEXT NOT NULL,
  manifest TEXT NOT NULL,
  PRIMARY KEY(pod_id,hash)
);
CREATE TABLE validations(
  pod_id TEXT NOT NULL,
  script_hash TEXT NOT NULL,
  assignment_revision INTEGER NOT NULL,
  resource_epoch INTEGER NOT NULL,
  evidence TEXT NOT NULL,
  PRIMARY KEY(pod_id,script_hash,assignment_revision,resource_epoch),
  FOREIGN KEY(pod_id,script_hash) REFERENCES scripts(pod_id,hash)
);
CREATE TABLE script_drafts(
  id TEXT PRIMARY KEY,
  pod_id TEXT NOT NULL REFERENCES pods(id),
  revision INTEGER NOT NULL,
  assignment_revision INTEGER NOT NULL,
  code TEXT NOT NULL,
  capabilities TEXT NOT NULL,
  validation TEXT,
  script_hash TEXT
);
CREATE TABLE draft_packages(
  draft_id TEXT PRIMARY KEY REFERENCES script_drafts(id) ON DELETE CASCADE,
  manifest TEXT NOT NULL
);
CREATE TABLE script_credential_approvals(
  pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE,
  script_hash TEXT NOT NULL,
  assignment_revision INTEGER NOT NULL,
  resource_epoch INTEGER NOT NULL,
  PRIMARY KEY(pod_id,script_hash)
);
CREATE TABLE dependency_sets(
  pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  manifest TEXT NOT NULL,
  lockfile TEXT NOT NULL,
  files TEXT NOT NULL,
  PRIMARY KEY(pod_id,hash),
  UNIQUE(pod_id,manifest)
);
CREATE TABLE script_dependencies(
  pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE,
  script_hash TEXT NOT NULL,
  dependency_hash TEXT NOT NULL,
  PRIMARY KEY(pod_id,script_hash),
  FOREIGN KEY(pod_id,dependency_hash) REFERENCES dependency_sets(pod_id,hash)
);
CREATE TABLE dependency_domains(path TEXT PRIMARY KEY, owner_pid INTEGER NOT NULL);
CREATE TABLE checkpoints(pod_id TEXT PRIMARY KEY REFERENCES pods(id), revision INTEGER NOT NULL, body TEXT NOT NULL);
CREATE TABLE sources(
  pod_id TEXT NOT NULL REFERENCES pods(id),
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  locator TEXT NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY(pod_id,id,version)
);
CREATE TABLE claims(
  pod_id TEXT NOT NULL REFERENCES pods(id),
  id TEXT NOT NULL,
  matter TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('finding','question','gap')),
  body TEXT NOT NULL,
  citations TEXT NOT NULL,
  supersedes TEXT,
  revision INTEGER NOT NULL,
  PRIMARY KEY(pod_id,id)
);
CREATE TABLE pod_descriptions(
  pod_id TEXT PRIMARY KEY REFERENCES pods(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0,
  covered_row INTEGER NOT NULL DEFAULT 0,
  requested_row INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  updated_at INTEGER,
  work_body TEXT NOT NULL DEFAULT '',
  work_row INTEGER NOT NULL DEFAULT 0,
  work_offset INTEGER NOT NULL DEFAULT 0,
  manual INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE summary_domains(path TEXT PRIMARY KEY, owner_pid INTEGER NOT NULL);
CREATE TABLE pod_variables(
  pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY(pod_id,name)
);
CREATE TABLE secret_requests(
  id TEXT PRIMARY KEY,
  pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('requested','filled','collected','expired','failed')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  error TEXT
);
CREATE TABLE local_only_pods(pod_id TEXT PRIMARY KEY REFERENCES pods(id) ON DELETE CASCADE);
-- Resources, grants and sandbox
CREATE TABLE resources(
  id TEXT PRIMARY KEY,
  pod_id TEXT NOT NULL REFERENCES pods(id),
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('reference','directory','tool','connection','credential')),
  state TEXT NOT NULL CHECK(state IN ('ready','missing','expired','revoked','refreshRequired')),
  name TEXT NOT NULL,
  configuration TEXT NOT NULL
);
CREATE TABLE resource_epochs(pod_id TEXT PRIMARY KEY REFERENCES pods(id), epoch INTEGER NOT NULL);
CREATE TABLE resource_aliases(
  pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  PRIMARY KEY(pod_id,alias)
);
CREATE TABLE snapshot_sets(
  id TEXT PRIMARY KEY,
  pod_id TEXT NOT NULL REFERENCES pods(id),
  epoch INTEGER NOT NULL,
  manifest TEXT NOT NULL
);
CREATE TABLE reference_observations(
  pod_id TEXT NOT NULL REFERENCES pods(id),
  resource_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  hash TEXT NOT NULL,
  generation INTEGER NOT NULL,
  error TEXT,
  PRIMARY KEY(pod_id,resource_id)
);
CREATE TABLE program_leases(
  pod_id TEXT PRIMARY KEY REFERENCES pods(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL UNIQUE,
  application_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  assignment_revision INTEGER NOT NULL
);
CREATE TABLE pod_grants(
  id TEXT PRIMARY KEY,
  pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  cli_id TEXT NOT NULL,
  details TEXT NOT NULL,
  display TEXT NOT NULL,
  grant_type TEXT NOT NULL CHECK(grant_type IN ('once','timed','always')),
  state TEXT NOT NULL CHECK(state IN ('pending','approved','denied','revoked','expired','used')),
  approved_in_session INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX pod_grants_coverage ON pod_grants(pod_id, cli_id, state);
CREATE TABLE pod_sandbox(
  pod_id TEXT PRIMARY KEY REFERENCES pods(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK(level IN ('isolated','owner'))
);
CREATE TABLE pod_sandbox_deny(
  pod_id TEXT PRIMARY KEY REFERENCES pods(id) ON DELETE CASCADE,
  paths TEXT NOT NULL
);
-- Runs and scheduling
CREATE TABLE settings(
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL,
  concurrency INTEGER NOT NULL CHECK(concurrency BETWEEN 1 AND 8)
);
CREATE TABLE schedules(
  pod_id TEXT PRIMARY KEY REFERENCES pods(id),
  revision INTEGER NOT NULL,
  spec TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER,
  error TEXT
);
CREATE TABLE accepted_events(
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  pod_id TEXT NOT NULL REFERENCES pods(id),
  source TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  run_id TEXT,
  error TEXT,
  UNIQUE(pod_id,source,dedupe_key)
);
CREATE INDEX ready_events ON accepted_events(state,pod_id,sequence);
CREATE INDEX accepted_events_run ON accepted_events(run_id);
CREATE TABLE runs(
  id TEXT PRIMARY KEY,
  pod_id TEXT NOT NULL REFERENCES pods(id),
  script_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  summary TEXT NOT NULL,
  error TEXT,
  checkpoint_revision INTEGER NOT NULL,
  assignment_revision INTEGER NOT NULL
);
CREATE INDEX runs_retention ON runs(pod_id,started_at DESC);
CREATE TABLE run_inputs(
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  reason TEXT NOT NULL,
  event_ids TEXT NOT NULL,
  retry_at INTEGER,
  retry_attempt INTEGER NOT NULL DEFAULT 0,
  retry_epoch INTEGER
);
CREATE TABLE run_events(
  run_id TEXT NOT NULL REFERENCES runs(id),
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY(run_id,sequence)
);
CREATE TABLE run_leases(
  pod_id TEXT PRIMARY KEY REFERENCES pods(id),
  run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),
  boot_id TEXT NOT NULL,
  heartbeat INTEGER NOT NULL,
  process_id INTEGER
);
CREATE TABLE execution_domains(
  path TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  owner_pid INTEGER NOT NULL
);
CREATE TABLE recovery_reviews(
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  state TEXT NOT NULL,
  error TEXT,
  checked_at INTEGER NOT NULL,
  request_event_id TEXT
);
CREATE TABLE effect_ledger(
  pod_id TEXT NOT NULL REFERENCES pods(id),
  effect_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  run_id TEXT REFERENCES runs(id),
  state TEXT NOT NULL,
  result TEXT,
  PRIMARY KEY(pod_id,effect_key),
  CHECK(run_id IS NOT NULL OR state='completed')
);
CREATE INDEX effects_run ON effect_ledger(run_id);
CREATE TABLE run_deletion_jobs(run_id TEXT PRIMARY KEY, error TEXT);
CREATE TABLE inbox_outbox(
  event_id TEXT PRIMARY KEY,
  pod_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  publication TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','delivered','refused')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL,
  result TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX inbox_outbox_due ON inbox_outbox(state, next_at);
-- Mail knowledge
CREATE TABLE mail_inventory(
  pod_id TEXT PRIMARY KEY REFERENCES pods(id),
  scope TEXT NOT NULL,
  phase TEXT NOT NULL,
  folder_index INTEGER NOT NULL,
  cursor TEXT,
  completed_at INTEGER
);
CREATE TABLE mail_items(
  pod_id TEXT NOT NULL REFERENCES pods(id),
  account TEXT NOT NULL,
  id TEXT NOT NULL,
  folder TEXT NOT NULL,
  source_id TEXT NOT NULL,
  conversation TEXT NOT NULL,
  metadata TEXT NOT NULL,
  PRIMARY KEY(pod_id,account,id)
);
CREATE INDEX mail_conversation ON mail_items(pod_id,conversation);
CREATE TABLE mail_receipts(
  pod_id TEXT NOT NULL REFERENCES pods(id),
  source_id TEXT NOT NULL,
  recipe TEXT NOT NULL,
  context_hash TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY(pod_id,source_id,recipe)
);
CREATE TABLE mail_contexts(
  pod_id TEXT NOT NULL REFERENCES pods(id),
  hash TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY(pod_id,hash)
);
CREATE TABLE source_derivations(
  pod_id TEXT NOT NULL REFERENCES pods(id),
  source_id TEXT NOT NULL,
  original_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  PRIMARY KEY(pod_id,source_id)
);
-- Workspace, account and data
CREATE TABLE connections(
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account TEXT NOT NULL,
  state TEXT NOT NULL,
  error TEXT,
  metadata TEXT NOT NULL
);
CREATE TABLE onboarding(
  id INTEGER PRIMARY KEY CHECK(id=1),
  complete INTEGER NOT NULL,
  default_owner TEXT REFERENCES connections(id)
);
CREATE TABLE data_settings(
  id INTEGER PRIMARY KEY CHECK(id=1),
  limit_bytes INTEGER NOT NULL,
  used_bytes INTEGER NOT NULL,
  error TEXT
);
CREATE TABLE deletion_jobs(pod_id TEXT PRIMARY KEY, payload TEXT NOT NULL, error TEXT);
CREATE TABLE pod_organization(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
CREATE TABLE pod_groups(id TEXT PRIMARY KEY, name TEXT NOT NULL, collapsed INTEGER NOT NULL CHECK(collapsed IN (0,1)));
CREATE TABLE pod_memberships(
  pod_id TEXT PRIMARY KEY REFERENCES pods(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES pod_groups(id) ON DELETE CASCADE
);
CREATE INDEX group_members ON pod_memberships(group_id);
CREATE TABLE remote_registration(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL, enabled INTEGER NOT NULL);
CREATE TABLE remote_pods(
  pod_id TEXT PRIMARY KEY REFERENCES pods(id),
  owner TEXT NOT NULL,
  runtime_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  phase TEXT NOT NULL,
  identity TEXT,
  error TEXT
);
-- Conversations and the assistant action journal
CREATE TABLE master_messages(
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE master_message_scopes(
  message_id TEXT PRIMARY KEY REFERENCES master_messages(id) ON DELETE CASCADE,
  scope TEXT NOT NULL
);
CREATE TABLE master_contexts(scope TEXT PRIMARY KEY, thread_id TEXT, state TEXT NOT NULL, error TEXT);
CREATE TABLE master_creations(id TEXT PRIMARY KEY, pod_id TEXT UNIQUE REFERENCES pods(id) ON DELETE CASCADE);
CREATE TABLE master_actions(
  id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  request TEXT NOT NULL,
  state TEXT NOT NULL,
  result TEXT,
  error TEXT
);
CREATE TABLE pod_chat_origins(
  pod_id TEXT PRIMARY KEY REFERENCES pods(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES master_messages(id) ON DELETE CASCADE
);
CREATE TABLE chat_conversations(
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  origin_pod TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE chat_contexts(
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id),
  revision INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(conversation_id,revision)
);
CREATE TABLE chat_members(
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id),
  pod_id TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY(conversation_id,pod_id)
);
CREATE TABLE chat_message_context(
  message_id TEXT PRIMARY KEY REFERENCES master_messages(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id),
  revision INTEGER NOT NULL
);
CREATE INDEX chat_message_history ON chat_message_context(conversation_id,revision);
CREATE TABLE control_runs(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, kind TEXT NOT NULL);
-- Definitions and sharing
CREATE TABLE owners(
  issuer TEXT NOT NULL CHECK(length(issuer) BETWEEN 1 AND 2048),
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 320),
  PRIMARY KEY(issuer,subject)
);
CREATE TABLE pod_definitions(
  id TEXT PRIMARY KEY,
  owner_issuer TEXT NOT NULL,
  owner_subject TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(owner_issuer,owner_subject) REFERENCES owners(issuer,subject)
);
CREATE TABLE pod_definition_versions(
  definition_id TEXT NOT NULL REFERENCES pod_definitions(id),
  version INTEGER NOT NULL CHECK(version>0),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  lock_hash TEXT NOT NULL CHECK(length(lock_hash)=64),
  contract TEXT NOT NULL CHECK(json_valid(contract) AND json_type(contract)='object'),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(definition_id,version)
);
CREATE TABLE pod_definition_sources(
  definition_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('legacy','published')),
  source_pod_id TEXT REFERENCES pods(id),
  manifest TEXT CHECK(manifest IS NULL OR json_valid(manifest)),
  packages TEXT NOT NULL CHECK(json_valid(packages)),
  dependency_hash TEXT,
  FOREIGN KEY(source_pod_id,dependency_hash) REFERENCES dependency_sets(pod_id,hash),
  PRIMARY KEY(definition_id,version),
  FOREIGN KEY(definition_id,version) REFERENCES pod_definition_versions(definition_id,version)
);
CREATE TABLE definition_config(
  definition_id TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('public','secret-reference')),
  value TEXT NOT NULL CHECK(json_valid(value)),
  PRIMARY KEY(definition_id,definition_version,name),
  FOREIGN KEY(definition_id,definition_version) REFERENCES pod_definition_versions(definition_id,version)
);
CREATE TABLE instance_definition_bindings(
  pod_id TEXT PRIMARY KEY REFERENCES pods(id),
  definition_id TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  binding_revision INTEGER NOT NULL CHECK(binding_revision>0),
  FOREIGN KEY(definition_id,definition_version) REFERENCES pod_definition_versions(definition_id,version)
);
CREATE TABLE definition_instance_requests(
  id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  pod_id TEXT NOT NULL UNIQUE REFERENCES pods(id),
  definition_id TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  owner_issuer TEXT NOT NULL,
  owner_subject TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','ready','failed')),
  error TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(definition_id,definition_version) REFERENCES pod_definition_versions(definition_id,version),
  FOREIGN KEY(owner_issuer,owner_subject) REFERENCES owners(issuer,subject)
);
CREATE TABLE definition_update_drafts(
  draft_id TEXT PRIMARY KEY REFERENCES script_drafts(id),
  pod_id TEXT NOT NULL REFERENCES pods(id),
  definition_id TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  expected_binding INTEGER NOT NULL,
  expected_active TEXT,
  FOREIGN KEY(definition_id,definition_version) REFERENCES pod_definition_versions(definition_id,version)
);
CREATE TABLE portable_imports(
  id TEXT PRIMARY KEY,
  owner_issuer TEXT NOT NULL,
  owner_subject TEXT NOT NULL,
  transfer_hash TEXT NOT NULL CHECK(length(transfer_hash)=64),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  archive_hash TEXT CHECK(archive_hash IS NULL OR archive_hash=transfer_hash),
  state TEXT NOT NULL CHECK(state IN ('staged','committed','completed','cancelled')),
  revision INTEGER NOT NULL,
  manifest TEXT NOT NULL CHECK(json_valid(manifest)),
  setup TEXT NOT NULL CHECK(json_valid(setup)),
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(owner_issuer,owner_subject) REFERENCES owners(issuer,subject)
);
CREATE TABLE portable_import_pods(
  import_id TEXT NOT NULL REFERENCES portable_imports(id),
  key TEXT NOT NULL,
  pod_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY(import_id,key)
);

-- Tags of Pods (issue 1459)
CREATE TABLE item_tags(
  id TEXT PRIMARY KEY,
  tags TEXT NOT NULL CHECK(json_valid(tags) AND json_type(tags)='array'),
  revision INTEGER NOT NULL CHECK(revision>0),
  updated_at INTEGER NOT NULL
);

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
CREATE TABLE approval_batches(
  id TEXT PRIMARY KEY,
  pod_id TEXT NOT NULL REFERENCES pods(id),
  title TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  url TEXT CHECK(url IS NULL OR length(url)<=2048),
  next_poll_at INTEGER NOT NULL,
  polls INTEGER NOT NULL DEFAULT 0 CHECK(polls>=0),
  error TEXT CHECK(error IS NULL OR length(error)<=2000),
  created_at INTEGER NOT NULL
);
CREATE TABLE action_approvals(
  id TEXT PRIMARY KEY,
  pod_id TEXT NOT NULL REFERENCES pods(id),
  action TEXT NOT NULL CHECK(action IN ('mail.archive')),
  object TEXT NOT NULL CHECK(length(object) BETWEEN 1 AND 500),
  payload TEXT NOT NULL CHECK(json_valid(payload) AND json_type(payload)='object'),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  authority TEXT NOT NULL CHECK(json_valid(authority) AND json_type(authority)='object'),
  batch_id TEXT REFERENCES approval_batches(id),
  grant_id TEXT CHECK(grant_id IS NULL OR length(grant_id) BETWEEN 1 AND 128),
  state TEXT NOT NULL CHECK(state IN ('collecting','requested','approved','denied','expired','consumed','withdrawn','unknown')),
  reason TEXT CHECK(reason IS NULL OR length(reason)<=2000),
  released_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(pod_id,action,object,payload_hash),
  CHECK(state IN ('collecting','withdrawn') OR batch_id IS NOT NULL)
);
CREATE INDEX action_approvals_state ON action_approvals(pod_id,state,created_at);
CREATE TABLE effect_attempts(
  action_key TEXT NOT NULL CHECK(length(action_key)=64),
  attempt INTEGER NOT NULL CHECK(attempt>0),
  pod_id TEXT NOT NULL,
  run_id TEXT,
  operation TEXT NOT NULL,
  input_hash TEXT NOT NULL CHECK(length(input_hash)=64),
  state TEXT NOT NULL CHECK(state IN ('intent','unknown','confirmed_applied','confirmed_not_applied')),
  origin TEXT NOT NULL CHECK(json_valid(origin) AND json_type(origin)='object'),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(action_key,attempt)
);
CREATE UNIQUE INDEX effect_execution_guard ON effect_attempts(action_key) WHERE state!='confirmed_not_applied';
CREATE TABLE effect_receipts(
  action_key TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence>0),
  outcome TEXT NOT NULL CHECK(outcome IN ('intent','unknown','confirmed_applied','confirmed_not_applied')),
  body TEXT NOT NULL CHECK(json_valid(body)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(action_key,attempt,sequence),
  FOREIGN KEY(action_key,attempt) REFERENCES effect_attempts(action_key,attempt)
);
CREATE TABLE storage_receipts(
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('conversion','restore','restore-reviewed')),
  body TEXT NOT NULL CHECK(json_valid(body) AND json_type(body)='object'),
  created_at INTEGER NOT NULL
);

-- Generic inert history of the retired network runtime (issue 1465): one row per converted legacy row
CREATE TABLE legacy_records(
  source TEXT NOT NULL CHECK(length(source) BETWEEN 1 AND 64),
  row_id INTEGER NOT NULL,
  body TEXT NOT NULL CHECK(json_valid(body) AND json_type(body)='object'),
  PRIMARY KEY(source,row_id)
);
`

/** The singleton rows of a fresh profile. */
export const baselineRows = `
INSERT INTO settings VALUES(1,1,2);
INSERT INTO data_settings VALUES(1,10737418240,0,NULL);
INSERT INTO onboarding VALUES(1,0,NULL);
INSERT INTO pod_organization VALUES(1,1);
INSERT INTO data_sequence VALUES(1,0);
`
