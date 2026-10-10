PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE pods(id TEXT PRIMARY KEY, name TEXT NOT NULL, assignment TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, lifecycle TEXT NOT NULL DEFAULT 'paused' CHECK(lifecycle IN ('active','paused','archived')), active_script TEXT, metadata_revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE assignments(pod_id TEXT NOT NULL REFERENCES pods(id), revision INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(pod_id,revision));
CREATE TABLE scripts(pod_id TEXT NOT NULL REFERENCES pods(id), hash TEXT NOT NULL, manifest TEXT NOT NULL, PRIMARY KEY(pod_id,hash));
CREATE TABLE checkpoints(pod_id TEXT PRIMARY KEY REFERENCES pods(id), revision INTEGER NOT NULL, body TEXT NOT NULL);
CREATE TABLE sources(pod_id TEXT NOT NULL REFERENCES pods(id), id TEXT NOT NULL, version TEXT NOT NULL, locator TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(pod_id,id,version));
CREATE TABLE claims(pod_id TEXT NOT NULL REFERENCES pods(id), id TEXT NOT NULL, matter TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('finding','question','gap')), body TEXT NOT NULL, citations TEXT NOT NULL, supersedes TEXT, revision INTEGER NOT NULL, PRIMARY KEY(pod_id,id));
CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, concurrency INTEGER NOT NULL CHECK(concurrency BETWEEN 1 AND 8));
INSERT INTO settings VALUES(1,1,2);
CREATE TABLE validations(pod_id TEXT NOT NULL, script_hash TEXT NOT NULL, assignment_revision INTEGER NOT NULL, resource_epoch INTEGER NOT NULL, evidence TEXT NOT NULL, PRIMARY KEY(pod_id,script_hash,assignment_revision,resource_epoch), FOREIGN KEY(pod_id,script_hash) REFERENCES scripts(pod_id,hash));
CREATE TABLE resource_epochs(pod_id TEXT PRIMARY KEY REFERENCES pods(id), epoch INTEGER NOT NULL);
CREATE TABLE snapshot_sets(id TEXT PRIMARY KEY, pod_id TEXT NOT NULL REFERENCES pods(id), epoch INTEGER NOT NULL, manifest TEXT NOT NULL);
CREATE TABLE runs(id TEXT PRIMARY KEY, pod_id TEXT NOT NULL REFERENCES pods(id), script_hash TEXT NOT NULL, state TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, summary TEXT NOT NULL, error TEXT, checkpoint_revision INTEGER NOT NULL, assignment_revision INTEGER NOT NULL);
CREATE TABLE run_leases(pod_id TEXT PRIMARY KEY REFERENCES pods(id), run_id TEXT NOT NULL UNIQUE REFERENCES runs(id), boot_id TEXT NOT NULL, heartbeat INTEGER NOT NULL, process_id INTEGER);
CREATE TABLE run_events(run_id TEXT NOT NULL REFERENCES runs(id), sequence INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(run_id,sequence));
CREATE TABLE schedules(pod_id TEXT PRIMARY KEY REFERENCES pods(id),revision INTEGER NOT NULL,spec TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,next_at INTEGER,error TEXT);
CREATE TABLE accepted_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,pod_id TEXT NOT NULL REFERENCES pods(id),source TEXT NOT NULL,dedupe_key TEXT NOT NULL,payload TEXT NOT NULL,accepted_at INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'pending',run_id TEXT,error TEXT,UNIQUE(pod_id,source,dedupe_key));
CREATE TABLE run_inputs(run_id TEXT PRIMARY KEY REFERENCES runs(id),reason TEXT NOT NULL,event_ids TEXT NOT NULL, retry_at INTEGER, retry_attempt INTEGER NOT NULL DEFAULT 0, retry_epoch INTEGER);
CREATE TABLE reference_observations(pod_id TEXT NOT NULL REFERENCES pods(id),resource_id TEXT NOT NULL,revision INTEGER NOT NULL,hash TEXT NOT NULL,generation INTEGER NOT NULL,error TEXT,PRIMARY KEY(pod_id,resource_id));
CREATE TABLE execution_domains(path TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),owner_pid INTEGER NOT NULL);
CREATE TABLE recovery_reviews(run_id TEXT PRIMARY KEY REFERENCES runs(id),state TEXT NOT NULL,error TEXT,checked_at INTEGER NOT NULL,request_event_id TEXT);
CREATE TABLE mail_inventory(pod_id TEXT PRIMARY KEY REFERENCES pods(id), scope TEXT NOT NULL, phase TEXT NOT NULL, folder_index INTEGER NOT NULL, cursor TEXT, completed_at INTEGER);
CREATE TABLE mail_items(pod_id TEXT NOT NULL REFERENCES pods(id), account TEXT NOT NULL, id TEXT NOT NULL, folder TEXT NOT NULL, source_id TEXT NOT NULL, conversation TEXT NOT NULL, metadata TEXT NOT NULL, PRIMARY KEY(pod_id,account,id));
CREATE TABLE mail_receipts(pod_id TEXT NOT NULL REFERENCES pods(id), source_id TEXT NOT NULL, recipe TEXT NOT NULL, context_hash TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(pod_id,source_id,recipe));
CREATE TABLE mail_extractions(pod_id TEXT NOT NULL REFERENCES pods(id), source_id TEXT NOT NULL, parser TEXT NOT NULL, text_source_id TEXT NOT NULL, gap TEXT, PRIMARY KEY(pod_id,source_id,parser));
CREATE TABLE mail_contexts(pod_id TEXT NOT NULL REFERENCES pods(id), hash TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(pod_id,hash));
CREATE TABLE source_derivations(pod_id TEXT NOT NULL REFERENCES pods(id), source_id TEXT NOT NULL, original_id TEXT NOT NULL, operation TEXT NOT NULL, PRIMARY KEY(pod_id,source_id));
CREATE TABLE master_inputs(id TEXT PRIMARY KEY,request_hash TEXT NOT NULL);
CREATE TABLE master_domains(path TEXT PRIMARY KEY, owner_pid INTEGER NOT NULL);
CREATE TABLE master_session(id INTEGER PRIMARY KEY CHECK(id=1),thread_id TEXT,active_turn TEXT,state TEXT NOT NULL,error TEXT);
INSERT INTO master_session VALUES(1,NULL,NULL,'idle',NULL);
CREATE TABLE master_messages(id TEXT PRIMARY KEY,role TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE master_actions(id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,request TEXT NOT NULL,state TEXT NOT NULL,result TEXT,error TEXT);
CREATE TABLE script_drafts(id TEXT PRIMARY KEY,pod_id TEXT NOT NULL REFERENCES pods(id),revision INTEGER NOT NULL,assignment_revision INTEGER NOT NULL,code TEXT NOT NULL,capabilities TEXT NOT NULL,validation TEXT,script_hash TEXT);
CREATE TABLE access_proposals(id TEXT PRIMARY KEY,pod_id TEXT NOT NULL REFERENCES pods(id),body TEXT NOT NULL,state TEXT NOT NULL);
CREATE TABLE connections(id TEXT PRIMARY KEY,provider TEXT NOT NULL,account TEXT NOT NULL,state TEXT NOT NULL,error TEXT,metadata TEXT NOT NULL);
CREATE TABLE onboarding(id INTEGER PRIMARY KEY CHECK(id=1),complete INTEGER NOT NULL, default_owner TEXT REFERENCES connections(id));
INSERT INTO onboarding VALUES(1,0,NULL);
CREATE TABLE data_settings(id INTEGER PRIMARY KEY CHECK(id=1),limit_bytes INTEGER NOT NULL,used_bytes INTEGER NOT NULL,error TEXT);
INSERT INTO data_settings VALUES(1,10737418240,0,NULL);
CREATE TABLE deletion_jobs(pod_id TEXT PRIMARY KEY,payload TEXT NOT NULL,error TEXT);
CREATE TABLE pod_organization(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);
INSERT INTO pod_organization VALUES(1,1);
CREATE TABLE pod_groups(id TEXT PRIMARY KEY,name TEXT NOT NULL,collapsed INTEGER NOT NULL CHECK(collapsed IN (0,1)));
CREATE TABLE pod_memberships(pod_id TEXT PRIMARY KEY REFERENCES pods(id) ON DELETE CASCADE,group_id TEXT NOT NULL REFERENCES pod_groups(id) ON DELETE CASCADE);
CREATE TABLE script_credential_approvals(pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE,script_hash TEXT NOT NULL,assignment_revision INTEGER NOT NULL,resource_epoch INTEGER NOT NULL,PRIMARY KEY(pod_id,script_hash));
CREATE TABLE pod_variables(pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE,name TEXT NOT NULL,value TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(pod_id,name));
CREATE TABLE master_contexts(scope TEXT PRIMARY KEY,thread_id TEXT,state TEXT NOT NULL,error TEXT);
INSERT INTO master_contexts VALUES('',NULL,'idle',NULL);
CREATE TABLE master_message_scopes(message_id TEXT PRIMARY KEY REFERENCES master_messages(id) ON DELETE CASCADE,scope TEXT NOT NULL);
CREATE TABLE program_leases(pod_id TEXT PRIMARY KEY REFERENCES pods(id) ON DELETE CASCADE,session_id TEXT NOT NULL UNIQUE,application_id TEXT NOT NULL,epoch INTEGER NOT NULL,assignment_revision INTEGER NOT NULL);
CREATE TABLE master_creations(id TEXT PRIMARY KEY,pod_id TEXT UNIQUE REFERENCES pods(id) ON DELETE CASCADE);
CREATE TABLE pod_chat_origins(pod_id TEXT PRIMARY KEY REFERENCES pods(id) ON DELETE CASCADE,message_id TEXT NOT NULL REFERENCES master_messages(id) ON DELETE CASCADE);
CREATE TABLE pod_descriptions(pod_id TEXT PRIMARY KEY REFERENCES pods(id) ON DELETE CASCADE,body TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,covered_row INTEGER NOT NULL DEFAULT 0,requested_row INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'pending',error TEXT,updated_at INTEGER,work_body TEXT NOT NULL DEFAULT '',work_row INTEGER NOT NULL DEFAULT 0,work_offset INTEGER NOT NULL DEFAULT 0, manual INTEGER NOT NULL DEFAULT 0);
CREATE TABLE summary_domains(path TEXT PRIMARY KEY,owner_pid INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS "resources"(id TEXT PRIMARY KEY, pod_id TEXT NOT NULL REFERENCES pods(id), revision INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('reference','directory','tool','connection','credential')), state TEXT NOT NULL CHECK(state IN ('ready','missing','expired','revoked','refreshRequired')), name TEXT NOT NULL, configuration TEXT NOT NULL);
CREATE TABLE draft_packages(draft_id TEXT PRIMARY KEY REFERENCES script_drafts(id) ON DELETE CASCADE, manifest TEXT NOT NULL);
CREATE TABLE dependency_sets(pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE,hash TEXT NOT NULL,manifest TEXT NOT NULL,lockfile TEXT NOT NULL,files TEXT NOT NULL,PRIMARY KEY(pod_id,hash),UNIQUE(pod_id,manifest));
CREATE TABLE script_dependencies(pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE,script_hash TEXT NOT NULL,dependency_hash TEXT NOT NULL,PRIMARY KEY(pod_id,script_hash),FOREIGN KEY(pod_id,dependency_hash) REFERENCES dependency_sets(pod_id,hash));
CREATE TABLE dependency_domains(path TEXT PRIMARY KEY,owner_pid INTEGER NOT NULL);
CREATE TABLE workflows(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, name TEXT NOT NULL, nodes TEXT NOT NULL, schedule TEXT, enabled INTEGER NOT NULL DEFAULT 0, next_at INTEGER, paused INTEGER NOT NULL DEFAULT 1, mail TEXT, archived INTEGER NOT NULL DEFAULT 0, mode TEXT NOT NULL DEFAULT 'sequence', group_id TEXT);
CREATE TABLE workflow_members(workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, pod_id TEXT NOT NULL REFERENCES pods(id), PRIMARY KEY(workflow_id,pod_id));
CREATE TABLE workflow_runs(id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id), revision INTEGER NOT NULL, definition TEXT NOT NULL, trigger TEXT NOT NULL, state TEXT NOT NULL, reason TEXT, started_at INTEGER NOT NULL, finished_at INTEGER, paused INTEGER NOT NULL DEFAULT 0);
CREATE TABLE workflow_nodes(workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id), pod_id TEXT NOT NULL REFERENCES pods(id), script_hash TEXT, assignment_revision INTEGER NOT NULL, resource_epoch INTEGER NOT NULL, state TEXT NOT NULL, run_id TEXT REFERENCES runs(id), reason TEXT, output TEXT, PRIMARY KEY(workflow_run_id,pod_id));
CREATE TABLE workflow_reservations(pod_id TEXT PRIMARY KEY REFERENCES pods(id), workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id));
CREATE TABLE workflow_attempts(run_id TEXT PRIMARY KEY REFERENCES runs(id), workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id), pod_id TEXT NOT NULL REFERENCES pods(id));
CREATE TABLE workflow_mail_scopes(id TEXT PRIMARY KEY, mailbox TEXT NOT NULL, cursor TEXT, baseline_at INTEGER NOT NULL, initialized INTEGER NOT NULL DEFAULT 0, restored INTEGER NOT NULL DEFAULT 0);
CREATE TABLE workflow_mail_pending(scope_id TEXT NOT NULL REFERENCES workflow_mail_scopes(id), message_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(scope_id,message_id));
CREATE TABLE workflow_mail_processed(scope_id TEXT NOT NULL REFERENCES workflow_mail_scopes(id), message_id TEXT NOT NULL, PRIMARY KEY(scope_id,message_id));
CREATE TABLE workflow_mail_participants(scope_id TEXT NOT NULL REFERENCES workflow_mail_scopes(id), conversation TEXT NOT NULL, address TEXT NOT NULL, PRIMARY KEY(scope_id,conversation,address));
CREATE TABLE workflow_mail_batches(id TEXT PRIMARY KEY REFERENCES workflow_runs(id), scope_id TEXT NOT NULL REFERENCES workflow_mail_scopes(id), configuration TEXT NOT NULL, state TEXT NOT NULL);
CREATE TABLE workflow_mail_audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT, batch_id TEXT NOT NULL REFERENCES workflow_mail_batches(id), effect_key TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE control_runs(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,kind TEXT NOT NULL);
CREATE TABLE control_changes(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE chat_conversations(id TEXT PRIMARY KEY,scope TEXT NOT NULL UNIQUE,title TEXT NOT NULL,origin_pod TEXT,revision INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
INSERT INTO chat_conversations VALUES('8ce5ce43-51e4-402d-afad-be1c913e7c11','','Workspace chat',NULL,1,1791620000445,1791620000445);
CREATE TABLE chat_contexts(conversation_id TEXT NOT NULL REFERENCES chat_conversations(id),revision INTEGER NOT NULL,body TEXT NOT NULL,retired_thread TEXT,created_at INTEGER NOT NULL,PRIMARY KEY(conversation_id,revision));
INSERT INTO chat_contexts VALUES('8ce5ce43-51e4-402d-afad-be1c913e7c11',1,'{"podIds":[],"pods":[]}',NULL,1791620000445);
CREATE TABLE chat_members(conversation_id TEXT NOT NULL REFERENCES chat_conversations(id),pod_id TEXT NOT NULL,name TEXT NOT NULL,PRIMARY KEY(conversation_id,pod_id));
CREATE TABLE chat_message_context(message_id TEXT PRIMARY KEY REFERENCES master_messages(id) ON DELETE CASCADE,conversation_id TEXT NOT NULL REFERENCES chat_conversations(id),revision INTEGER NOT NULL);
CREATE TABLE chat_active(id INTEGER PRIMARY KEY CHECK(id=1),conversation_id TEXT REFERENCES chat_conversations(id));
INSERT INTO chat_active VALUES(1,NULL);
CREATE TABLE remote_program_catalog(id TEXT PRIMARY KEY,owner TEXT NOT NULL,definition TEXT NOT NULL,hash TEXT NOT NULL,revoked INTEGER NOT NULL);
CREATE TABLE remote_program_reviews(id TEXT PRIMARY KEY,pod_id TEXT NOT NULL REFERENCES pods(id),body TEXT NOT NULL);
CREATE TABLE remote_registration(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL,enabled INTEGER NOT NULL);
CREATE TABLE remote_pods(pod_id TEXT PRIMARY KEY REFERENCES pods(id),owner TEXT NOT NULL,runtime_id TEXT NOT NULL,generation TEXT NOT NULL,phase TEXT NOT NULL,identity TEXT,error TEXT);
CREATE TABLE remote_conversations(conversation_id TEXT PRIMARY KEY REFERENCES chat_conversations(id),owner TEXT NOT NULL);
CREATE TABLE remote_devices(id TEXT PRIMARY KEY,owner TEXT NOT NULL,keys TEXT NOT NULL,epoch INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE remote_inbox(id TEXT PRIMARY KEY,hash TEXT NOT NULL,device_id TEXT NOT NULL,route TEXT NOT NULL,state TEXT NOT NULL,receipt TEXT,result TEXT,created_at INTEGER NOT NULL);
CREATE TABLE remote_outbox(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,operation_id TEXT NOT NULL,device_id TEXT NOT NULL,route TEXT NOT NULL,body TEXT NOT NULL,envelope TEXT,acknowledged INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS "effect_ledger"(pod_id TEXT NOT NULL REFERENCES pods(id),effect_key TEXT NOT NULL,operation TEXT NOT NULL,input_hash TEXT NOT NULL,run_id TEXT REFERENCES runs(id),state TEXT NOT NULL,result TEXT,PRIMARY KEY(pod_id,effect_key),CHECK(run_id IS NOT NULL OR state='completed'));
CREATE TABLE run_deletion_jobs(run_id TEXT PRIMARY KEY,error TEXT);
CREATE TABLE workflow_channels(workflow_id TEXT NOT NULL, name TEXT NOT NULL, title TEXT NOT NULL, fields TEXT NOT NULL, PRIMARY KEY(workflow_id, name));
CREATE TABLE workflow_gates(workflow_id TEXT NOT NULL, key TEXT NOT NULL, definition TEXT NOT NULL, PRIMARY KEY(workflow_id, key));
CREATE TABLE workflow_values(workflow_id TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(workflow_id, name));
CREATE TABLE graph_items(id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, workflow_run_id TEXT NOT NULL, key TEXT NOT NULL, channel TEXT NOT NULL, node TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE graph_deliveries(item_id TEXT NOT NULL, node TEXT NOT NULL, state TEXT NOT NULL, workflow_run_id TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(item_id, node));
CREATE TABLE graph_item_events(id INTEGER PRIMARY KEY AUTOINCREMENT, workflow_id TEXT NOT NULL, workflow_run_id TEXT NOT NULL, key TEXT NOT NULL, node TEXT NOT NULL, outcome TEXT NOT NULL, channel TEXT, reason TEXT, confidence REAL, at INTEGER NOT NULL);
CREATE TABLE graph_gate_batches(id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, gate TEXT NOT NULL, pod_id TEXT NOT NULL, state TEXT NOT NULL, grant_id TEXT, url TEXT, title TEXT NOT NULL, digest TEXT NOT NULL, expires_at INTEGER NOT NULL, items TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE network_owners(
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
  FOREIGN KEY(owner_issuer,owner_subject) REFERENCES network_owners(issuer,subject)
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
CREATE TABLE instance_definition_bindings(
  pod_id TEXT PRIMARY KEY REFERENCES pods(id),
  definition_id TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  binding_revision INTEGER NOT NULL CHECK(binding_revision>0),
  FOREIGN KEY(definition_id,definition_version) REFERENCES pod_definition_versions(definition_id,version)
);
CREATE TABLE networks(
  id TEXT PRIMARY KEY,
  owner_issuer TEXT NOT NULL,
  owner_subject TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES pod_groups(id),
  name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'paused' CHECK(state IN ('active','paused','archived')),
  revision INTEGER NOT NULL CHECK(revision>0),
  activation_epoch INTEGER NOT NULL DEFAULT 1 CHECK(activation_epoch>0),
  restore_nonce TEXT NOT NULL,
  baseline_state TEXT NOT NULL DEFAULT 'ready' CHECK(baseline_state IN ('ready','review_required')),
  baseline_receipt TEXT CHECK(baseline_receipt IS NULL OR json_valid(baseline_receipt)),
  ancestor_workflow_id TEXT REFERENCES workflows(id),
  ancestor_revision INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(owner_issuer,owner_subject) REFERENCES network_owners(issuer,subject),
  CHECK(state!='active' OR baseline_state='ready'),
  UNIQUE(id,group_id),
  UNIQUE(id,owner_issuer,owner_subject,group_id),
  FOREIGN KEY(id,revision) REFERENCES network_revisions(network_id,revision) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE network_revisions(
  network_id TEXT NOT NULL REFERENCES networks(id),
  revision INTEGER NOT NULL CHECK(revision>0),
  contract TEXT NOT NULL CHECK(json_valid(contract) AND json_type(contract)='object'),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(network_id,revision)
);
CREATE TABLE network_members(
  network_id TEXT NOT NULL REFERENCES networks(id),
  pod_id TEXT NOT NULL UNIQUE REFERENCES pods(id),
  binding_revision INTEGER NOT NULL CHECK(binding_revision>0),
  definition_id TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  source_binding_id TEXT UNIQUE,
  UNIQUE(network_id,source_binding_id),
  PRIMARY KEY(network_id,pod_id),
  FOREIGN KEY(definition_id,definition_version) REFERENCES pod_definition_versions(definition_id,version)
);
CREATE TABLE network_subscriptions(
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL,
  network_revision INTEGER NOT NULL,
  pod_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  schema_hash TEXT NOT NULL CHECK(length(schema_hash)=64),
  serial_case INTEGER NOT NULL DEFAULT 0 CHECK(serial_case IN (0,1)),
  UNIQUE(network_id,network_revision,pod_id,channel),
  UNIQUE(network_id,id),
  FOREIGN KEY(network_id,network_revision) REFERENCES network_revisions(network_id,revision),
  FOREIGN KEY(network_id,pod_id) REFERENCES network_members(network_id,pod_id)
);
CREATE TABLE network_cases(
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  current_revision INTEGER NOT NULL CHECK(current_revision>0),
  parent_id TEXT,
  parent_revision INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(network_id,id),
  FOREIGN KEY(network_id,group_id) REFERENCES networks(id,group_id),
  FOREIGN KEY(network_id,parent_id) REFERENCES network_cases(network_id,id),
  FOREIGN KEY(parent_id,parent_revision) REFERENCES network_case_revisions(case_id,revision),
  CHECK((parent_id IS NULL AND parent_revision IS NULL) OR (parent_id IS NOT NULL AND parent_revision IS NOT NULL)),
  FOREIGN KEY(id,current_revision) REFERENCES network_case_revisions(case_id,revision) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE network_case_revisions(
  case_id TEXT NOT NULL REFERENCES network_cases(id),
  revision INTEGER NOT NULL CHECK(revision>0),
  source_mapping TEXT NOT NULL CHECK(json_valid(source_mapping)),
  supersedes_revision INTEGER,
  outcome TEXT NOT NULL DEFAULT 'open' CHECK(outcome IN ('open','completed','blocked','superseded','discarded')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(case_id,revision),
  FOREIGN KEY(case_id,supersedes_revision) REFERENCES network_case_revisions(case_id,revision)
);
CREATE TABLE network_case_sources(
  network_id TEXT NOT NULL,
  source_binding_id TEXT NOT NULL,
  source_item TEXT NOT NULL,
  source_version TEXT NOT NULL,
  case_id TEXT NOT NULL,
  case_revision INTEGER NOT NULL,
  PRIMARY KEY(network_id,source_binding_id,source_item,source_version),
  FOREIGN KEY(network_id,source_binding_id) REFERENCES network_members(network_id,source_binding_id),
  FOREIGN KEY(network_id,case_id) REFERENCES network_cases(network_id,id),
  FOREIGN KEY(case_id,case_revision) REFERENCES network_case_revisions(case_id,revision)
);
CREATE TABLE network_invocations(
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  network_id TEXT NOT NULL,
  network_revision INTEGER NOT NULL,
  pod_id TEXT NOT NULL,
  boot_nonce TEXT NOT NULL,
  restore_nonce TEXT NOT NULL,
  activation_epoch INTEGER NOT NULL CHECK(activation_epoch>0),
  claim_token TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation>0),
  state TEXT NOT NULL CHECK(state IN ('running','stopping','completed','failed','interrupted','blocked','unknown')),
  manifest TEXT NOT NULL CHECK(json_valid(manifest) AND json_type(manifest)='object'),
  staged_checkpoint TEXT CHECK(staged_checkpoint IS NULL OR json_valid(staged_checkpoint)),
  execution_kind TEXT NOT NULL DEFAULT 'script' CHECK(execution_kind IN ('script','gate_maintenance')),
  UNIQUE(network_id,run_id),
  FOREIGN KEY(network_id,network_revision) REFERENCES network_revisions(network_id,revision),
  FOREIGN KEY(network_id,pod_id) REFERENCES network_members(network_id,pod_id)
);
CREATE TABLE network_checkpoints(
  network_id TEXT NOT NULL,
  pod_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  body TEXT NOT NULL CHECK(json_valid(body) AND json_type(body)='object'),
  FOREIGN KEY(network_id,pod_id) REFERENCES network_members(network_id,pod_id)
);
CREATE TABLE network_effect_attempts(
  logical_action_key TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK(attempt>0),
  run_id TEXT NOT NULL REFERENCES network_invocations(run_id),
  case_id TEXT NOT NULL,
  case_revision INTEGER NOT NULL,
  input_hash TEXT NOT NULL CHECK(length(input_hash)=64),
  manifest_hash TEXT NOT NULL CHECK(length(manifest_hash)=64),
  state TEXT NOT NULL CHECK(state IN ('intent','unknown','confirmed_applied','confirmed_not_applied')),
  created_at INTEGER NOT NULL,
  network_id TEXT NOT NULL,
  PRIMARY KEY(logical_action_key,attempt),
  FOREIGN KEY(network_id,run_id) REFERENCES network_invocations(network_id,run_id),
  FOREIGN KEY(network_id,case_id) REFERENCES network_cases(network_id,id),
  FOREIGN KEY(case_id,case_revision) REFERENCES network_case_revisions(case_id,revision)
);
CREATE TABLE network_effect_receipts(
  logical_action_key TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence>0),
  outcome TEXT NOT NULL CHECK(outcome IN ('intent','unknown','confirmed_applied','confirmed_not_applied')),
  body TEXT NOT NULL CHECK(json_valid(body)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(logical_action_key,attempt,sequence),
  FOREIGN KEY(logical_action_key,attempt) REFERENCES network_effect_attempts(logical_action_key,attempt)
);
CREATE TABLE network_event_identities(
  network_id TEXT NOT NULL REFERENCES networks(id),
  namespace TEXT NOT NULL CHECK(namespace IN ('source','derived','replay')),
  identity_hash TEXT NOT NULL CHECK(length(identity_hash)=64),
  event_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  schema_hash TEXT NOT NULL CHECK(length(schema_hash)=64),
  accepted_at INTEGER NOT NULL,
  retain_until INTEGER NOT NULL,
  causal_references TEXT NOT NULL CHECK(json_valid(causal_references) AND json_type(causal_references)='array'),
  reviewed_watermark TEXT CHECK(reviewed_watermark IS NULL OR json_valid(reviewed_watermark)),
  PRIMARY KEY(network_id,namespace,identity_hash)
);
CREATE TABLE network_events(
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL,
  network_revision INTEGER NOT NULL,
  producer_pod_id TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  case_id TEXT NOT NULL,
  case_revision INTEGER NOT NULL,
  channel TEXT NOT NULL,
  item_key TEXT NOT NULL,
  origin TEXT NOT NULL CHECK(json_valid(origin) AND json_type(origin)='object'),
  schema_hash TEXT NOT NULL CHECK(length(schema_hash)=64),
  payload TEXT NOT NULL CHECK(json_valid(payload) AND json_type(payload)='object'),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  accepted_at INTEGER NOT NULL,
  UNIQUE(network_id,id),
  UNIQUE(network_id,id,case_id,case_revision),
  FOREIGN KEY(network_id,network_revision) REFERENCES network_revisions(network_id,revision),
  FOREIGN KEY(network_id,producer_pod_id) REFERENCES network_members(network_id,pod_id),
  FOREIGN KEY(definition_id,definition_version) REFERENCES pod_definition_versions(definition_id,version),
  FOREIGN KEY(network_id,case_id) REFERENCES network_cases(network_id,id),
  FOREIGN KEY(case_id,case_revision) REFERENCES network_case_revisions(case_id,revision)
);
CREATE TABLE network_deliveries(
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  case_revision INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','claimed','done','retry_wait','blocked','unknown','discarded')),
  ready_at INTEGER NOT NULL,
  accepted_at INTEGER NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt BETWEEN 0 AND 3),
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0),
  claim_token TEXT,
  boot_nonce TEXT,
  restore_nonce TEXT,
  activation_epoch INTEGER,
  run_id TEXT REFERENCES network_invocations(run_id),
  reason TEXT,
  review_receipt TEXT CHECK(review_receipt IS NULL OR json_valid(review_receipt)),
  UNIQUE(event_id,subscription_id),
  FOREIGN KEY(network_id,run_id) REFERENCES network_invocations(network_id,run_id),
  FOREIGN KEY(network_id,event_id,case_id,case_revision) REFERENCES network_events(network_id,id,case_id,case_revision),
  FOREIGN KEY(network_id,subscription_id) REFERENCES network_subscriptions(network_id,id),
  FOREIGN KEY(network_id,case_id) REFERENCES network_cases(network_id,id),
  FOREIGN KEY(case_id,case_revision) REFERENCES network_case_revisions(case_id,revision),
  CHECK(state!='claimed' OR (run_id IS NOT NULL AND claim_token IS NOT NULL AND boot_nonce IS NOT NULL AND restore_nonce IS NOT NULL AND activation_epoch IS NOT NULL AND generation>0))
);
CREATE TABLE network_queue_counts(
  network_id TEXT NOT NULL REFERENCES networks(id),
  state TEXT NOT NULL CHECK(state IN ('pending','claimed','done','retry_wait','blocked','unknown','discarded')),
  count INTEGER NOT NULL CHECK(count>=0),
  PRIMARY KEY(network_id,state)
);
CREATE TABLE network_joins(
  network_id TEXT NOT NULL REFERENCES networks(id),
  join_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  case_revision INTEGER NOT NULL,
  network_revision INTEGER NOT NULL,
  declaration TEXT NOT NULL CHECK(json_valid(declaration) AND json_type(declaration)='object'),
  deadline INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','completed','blocked','discarded')),
  reason TEXT,
  PRIMARY KEY(network_id,join_id,case_id,case_revision),
  FOREIGN KEY(network_id,network_revision) REFERENCES network_revisions(network_id,revision),
  FOREIGN KEY(network_id,case_id) REFERENCES network_cases(network_id,id),
  FOREIGN KEY(case_id,case_revision) REFERENCES network_case_revisions(case_id,revision)
);
CREATE TABLE network_join_inputs(
  network_id TEXT NOT NULL,
  join_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  case_revision INTEGER NOT NULL,
  channel TEXT NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY(network_id,join_id,case_id,case_revision,channel),
  FOREIGN KEY(network_id,join_id,case_id,case_revision) REFERENCES network_joins(network_id,join_id,case_id,case_revision),
  FOREIGN KEY(network_id,event_id,case_id,case_revision) REFERENCES network_events(network_id,id,case_id,case_revision)
);
CREATE TABLE workflow_revisions(
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  revision INTEGER NOT NULL CHECK(revision>0),
  definition TEXT NOT NULL CHECK(json_valid(definition) AND json_type(definition)='object'),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(workflow_id,revision)
);
CREATE TABLE workflow_call_requests(
  id TEXT PRIMARY KEY,
  caller_run_id TEXT NOT NULL REFERENCES network_invocations(run_id),
  network_id TEXT NOT NULL,
  network_revision INTEGER NOT NULL,
  case_id TEXT NOT NULL,
  case_revision INTEGER NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_revision INTEGER NOT NULL,
  workflow_run_id TEXT UNIQUE REFERENCES workflow_runs(id),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  request TEXT NOT NULL CHECK(json_valid(request) AND json_type(request)='object'),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','completed','failed','blocked','unknown','cancelled')),
  result TEXT CHECK(result IS NULL OR json_valid(result)),
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  FOREIGN KEY(network_id,network_revision) REFERENCES network_revisions(network_id,revision),
  FOREIGN KEY(network_id,case_id) REFERENCES network_cases(network_id,id),
  FOREIGN KEY(case_id,case_revision) REFERENCES network_case_revisions(case_id,revision),
  FOREIGN KEY(network_id,caller_run_id) REFERENCES network_invocations(network_id,run_id),
  FOREIGN KEY(workflow_id,workflow_revision) REFERENCES workflow_revisions(workflow_id,revision)
);
CREATE TABLE data_collections(
  id TEXT PRIMARY KEY,
  owner_issuer TEXT NOT NULL,
  owner_subject TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES pod_groups(id),
  name TEXT NOT NULL,
  current_version INTEGER NOT NULL CHECK(current_version>0),
  retention TEXT NOT NULL CHECK(json_valid(retention) AND json_type(retention)='object'),
  UNIQUE(owner_issuer,owner_subject,group_id,name),
  UNIQUE(id,owner_issuer,owner_subject,group_id),
  FOREIGN KEY(owner_issuer,owner_subject) REFERENCES network_owners(issuer,subject),
  FOREIGN KEY(id,current_version) REFERENCES data_collection_versions(collection_id,version) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE data_collection_versions(
  collection_id TEXT NOT NULL REFERENCES data_collections(id),
  version INTEGER NOT NULL CHECK(version>0),
  schema TEXT NOT NULL CHECK(json_valid(schema) AND json_type(schema)='object'),
  indexes TEXT NOT NULL CHECK(json_valid(indexes) AND json_type(indexes)='array'),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(collection_id,version)
);
CREATE TABLE data_permissions(
  network_id TEXT NOT NULL,
  pod_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  owner_issuer TEXT NOT NULL,
  owner_subject TEXT NOT NULL,
  group_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('read','write','delete')),
  revision INTEGER NOT NULL CHECK(revision>0),
  PRIMARY KEY(network_id,pod_id,collection_id,operation),
  FOREIGN KEY(network_id,pod_id) REFERENCES network_members(network_id,pod_id),
  FOREIGN KEY(network_id,owner_issuer,owner_subject,group_id) REFERENCES networks(id,owner_issuer,owner_subject,group_id),
  FOREIGN KEY(collection_id,owner_issuer,owner_subject,group_id) REFERENCES data_collections(id,owner_issuer,owner_subject,group_id)
);
CREATE TABLE data_records(
  collection_id TEXT NOT NULL REFERENCES data_collections(id),
  record_key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  tombstone INTEGER NOT NULL CHECK(tombstone IN (0,1)),
  PRIMARY KEY(collection_id,record_key),
  FOREIGN KEY(collection_id,record_key,revision) REFERENCES data_record_revisions(collection_id,record_key,revision) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE data_record_revisions(
  collection_id TEXT NOT NULL,
  record_key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  schema_version INTEGER NOT NULL,
  author_run_id TEXT NOT NULL REFERENCES network_invocations(run_id),
  definition_id TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  body TEXT CHECK(body IS NULL OR (json_valid(body) AND json_type(body)='object')),
  tombstone INTEGER NOT NULL CHECK(tombstone IN (0,1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(collection_id,record_key,revision),
  FOREIGN KEY(collection_id,record_key) REFERENCES data_records(collection_id,record_key),
  FOREIGN KEY(collection_id,schema_version) REFERENCES data_collection_versions(collection_id,version),
  FOREIGN KEY(definition_id,definition_version) REFERENCES pod_definition_versions(definition_id,version),
  CHECK((tombstone=1 AND body IS NULL) OR (tombstone=0 AND body IS NOT NULL))
);
CREATE TABLE artifact_scopes(
  id TEXT PRIMARY KEY,
  owner_issuer TEXT NOT NULL,
  owner_subject TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES pod_groups(id),
  collection_id TEXT,
  private_network_id TEXT,
  UNIQUE(id,owner_issuer,owner_subject,group_id),
  FOREIGN KEY(owner_issuer,owner_subject) REFERENCES network_owners(issuer,subject),
  FOREIGN KEY(collection_id,owner_issuer,owner_subject,group_id) REFERENCES data_collections(id,owner_issuer,owner_subject,group_id),
  FOREIGN KEY(private_network_id,owner_issuer,owner_subject,group_id) REFERENCES networks(id,owner_issuer,owner_subject,group_id),
  CHECK((collection_id IS NOT NULL AND private_network_id IS NULL) OR (collection_id IS NULL AND private_network_id IS NOT NULL))
);
CREATE TABLE artifacts(
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL REFERENCES artifact_scopes(id),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  size INTEGER NOT NULL CHECK(size BETWEEN 0 AND 268435456),
  media_type TEXT NOT NULL,
  storage_ref TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE artifact_permissions(
  network_id TEXT NOT NULL,
  pod_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  owner_issuer TEXT NOT NULL,
  owner_subject TEXT NOT NULL,
  group_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('read','create')),
  revision INTEGER NOT NULL CHECK(revision>0),
  PRIMARY KEY(network_id,pod_id,scope_id,operation),
  FOREIGN KEY(network_id,pod_id) REFERENCES network_members(network_id,pod_id),
  FOREIGN KEY(network_id,owner_issuer,owner_subject,group_id) REFERENCES networks(id,owner_issuer,owner_subject,group_id),
  FOREIGN KEY(scope_id,owner_issuer,owner_subject,group_id) REFERENCES artifact_scopes(id,owner_issuer,owner_subject,group_id)
);
CREATE TABLE artifact_references(
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  reference_kind TEXT NOT NULL CHECK(reference_kind IN ('record','event','invocation','gate','definition')),
  reference_id TEXT NOT NULL,
  PRIMARY KEY(artifact_id,reference_kind,reference_id)
);
CREATE TABLE network_gate_tasks(
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL,
  network_revision INTEGER NOT NULL,
  pod_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation>0),
  state TEXT NOT NULL CHECK(state IN ('preparing','pending','consuming','approved','denied','expired','superseded','unknown')),
  manifest TEXT NOT NULL CHECK(json_valid(manifest) AND json_type(manifest)='object'),
  manifest_hash TEXT NOT NULL CHECK(length(manifest_hash)=64),
  restore_nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  grant_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(network_id,id),
  FOREIGN KEY(network_id,network_revision) REFERENCES network_revisions(network_id,revision),
  FOREIGN KEY(network_id,pod_id) REFERENCES network_members(network_id,pod_id)
);
CREATE TABLE network_gate_task_attempts(
  task_id TEXT NOT NULL REFERENCES network_gate_tasks(id),
  attempt INTEGER NOT NULL CHECK(attempt>0),
  run_id TEXT NOT NULL UNIQUE REFERENCES network_invocations(run_id),
  generation INTEGER NOT NULL CHECK(generation>0),
  step_token TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('running','completed','interrupted','blocked','unknown')),
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  network_id TEXT NOT NULL,
  FOREIGN KEY(network_id,task_id) REFERENCES network_gate_tasks(network_id,id),
  FOREIGN KEY(network_id,run_id) REFERENCES network_invocations(network_id,run_id),
  PRIMARY KEY(task_id,attempt)
);
CREATE TABLE network_trace_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id TEXT NOT NULL REFERENCES networks(id),
  case_id TEXT,
  run_id TEXT REFERENCES network_invocations(run_id),
  event_id TEXT,
  kind TEXT NOT NULL,
  body TEXT NOT NULL CHECK(json_valid(body) AND json_type(body)='object'),
  created_at INTEGER NOT NULL,
  FOREIGN KEY(network_id,case_id) REFERENCES network_cases(network_id,id),
  FOREIGN KEY(network_id,run_id) REFERENCES network_invocations(network_id,run_id),
  FOREIGN KEY(network_id,event_id) REFERENCES network_events(network_id,id)
);
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
INSERT INTO network_scheduler_state VALUES(1,0,NULL,NULL,NULL,NULL);
CREATE TABLE network_runtime_status(
  network_id TEXT PRIMARY KEY REFERENCES networks(id),
  last_pod TEXT,
  last_dispatch_at INTEGER,
  intake_error TEXT,
  inspected_at INTEGER
);
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
CREATE TABLE network_maintenance_status(
  network_id TEXT NOT NULL REFERENCES networks(id),
  operation TEXT NOT NULL CHECK(operation IN ('traces','artifacts')),
  body TEXT CHECK(body IS NULL OR json_valid(body)),
  failure_count INTEGER NOT NULL CHECK(failure_count>0),
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  PRIMARY KEY(network_id,operation)
);
CREATE TABLE network_data_staging(
  run_id TEXT NOT NULL REFERENCES network_invocations(run_id),
  collection_id TEXT NOT NULL REFERENCES data_collections(id),
  record_key TEXT NOT NULL,
  base_revision INTEGER NOT NULL CHECK(base_revision>=0),
  revision INTEGER NOT NULL CHECK(revision>base_revision),
  schema_version INTEGER NOT NULL,
  body TEXT CHECK(body IS NULL OR json_valid(body)),
  tombstone INTEGER NOT NULL CHECK(tombstone IN (0,1)),
  artifact_refs TEXT NOT NULL CHECK(json_valid(artifact_refs)),
  PRIMARY KEY(run_id,collection_id,record_key,revision)
);
CREATE TABLE data_record_provenance(
  collection_id TEXT NOT NULL,
  record_key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  pod_id TEXT NOT NULL REFERENCES pods(id),
  source_refs TEXT NOT NULL CHECK(json_valid(source_refs)),
  verification TEXT NOT NULL DEFAULT 'proposed' CHECK(verification IN ('proposed','owner_verified')),
  PRIMARY KEY(collection_id,record_key,revision),
  FOREIGN KEY(collection_id,record_key,revision) REFERENCES data_record_revisions(collection_id,record_key,revision)
);
CREATE TABLE data_index_values(
  collection_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  index_name TEXT NOT NULL,
  record_key TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_text TEXT,
  value_number REAL,
  PRIMARY KEY(collection_id,schema_version,index_name,record_key),
  FOREIGN KEY(collection_id,record_key) REFERENCES data_records(collection_id,record_key)
);
CREATE TABLE network_artifact_staging(
  run_id TEXT NOT NULL REFERENCES network_invocations(run_id),
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL REFERENCES artifact_scopes(id),
  content_hash TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size BETWEEN 0 AND 131072),
  media_type TEXT NOT NULL,
  storage_ref TEXT NOT NULL
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
CREATE TABLE composition_config(
  network_id TEXT NOT NULL REFERENCES networks(id),
  name TEXT NOT NULL,
  value TEXT NOT NULL CHECK(json_valid(value)),
  PRIMARY KEY(network_id,name)
);
CREATE TABLE instance_config(
  pod_id TEXT NOT NULL REFERENCES pods(id),
  name TEXT NOT NULL,
  value TEXT NOT NULL CHECK(json_valid(value)),
  PRIMARY KEY(pod_id,name)
);
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
  FOREIGN KEY(owner_issuer,owner_subject) REFERENCES network_owners(issuer,subject)
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
  FOREIGN KEY(owner_issuer,owner_subject) REFERENCES network_owners(issuer,subject)
);
CREATE TABLE portable_import_pods(
  import_id TEXT NOT NULL REFERENCES portable_imports(id),
  key TEXT NOT NULL,
  pod_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY(import_id,key)
);
CREATE TABLE resource_aliases(
  pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  PRIMARY KEY(pod_id,alias)
);
CREATE TABLE network_choices(
  network_id TEXT NOT NULL,
  network_revision INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  gate_key TEXT NOT NULL,
  option_key TEXT,
  result_event_id TEXT,
  decided_at INTEGER,
  PRIMARY KEY(network_id,event_id,gate_key),
  FOREIGN KEY(network_id,network_revision) REFERENCES network_revisions(network_id,revision),
  FOREIGN KEY(network_id,event_id) REFERENCES network_events(network_id,id),
  FOREIGN KEY(network_id,result_event_id) REFERENCES network_events(network_id,id),
  CHECK((option_key IS NULL AND result_event_id IS NULL AND decided_at IS NULL) OR
    (option_key IS NOT NULL AND result_event_id IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE TABLE collection_descriptions(id TEXT PRIMARY KEY, body TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE secret_requests(id TEXT PRIMARY KEY, pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE, alias TEXT NOT NULL, purpose TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('requested','filled','collected','expired','failed')), expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error TEXT);
CREATE TABLE network_gate_item_grants(
  task_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  grant_id TEXT NOT NULL CHECK(length(grant_id) BETWEEN 1 AND 128),
  PRIMARY KEY(task_id,delivery_id),
  FOREIGN KEY(task_id,delivery_id) REFERENCES network_gate_items(task_id,delivery_id)
);
CREATE TABLE inbox_outbox(event_id TEXT PRIMARY KEY, pod_id TEXT NOT NULL, run_id TEXT NOT NULL, digest TEXT NOT NULL, publication TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','delivered','refused')), attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, result TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE pod_grants(id TEXT PRIMARY KEY, pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE, issuer TEXT NOT NULL, subject TEXT NOT NULL, cli_id TEXT NOT NULL, details TEXT NOT NULL, display TEXT NOT NULL, grant_type TEXT NOT NULL CHECK(grant_type IN ('once','timed','always')), state TEXT NOT NULL CHECK(state IN ('pending','approved','denied','revoked','expired','used')), network_id TEXT, network_revision INTEGER, approved_in_session INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE pod_sandbox(pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE, source TEXT NOT NULL, network_revision INTEGER, level TEXT NOT NULL CHECK(level IN ('isolated','owner')), PRIMARY KEY(pod_id, source));
CREATE TABLE network_sandbox_resources(network_id TEXT NOT NULL, network_revision INTEGER NOT NULL, pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE, resource_id TEXT NOT NULL, PRIMARY KEY(network_id, resource_id));
CREATE TABLE pod_sandbox_deny(pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE, source TEXT NOT NULL, network_revision INTEGER, paths TEXT NOT NULL, PRIMARY KEY(pod_id, source));
CREATE TABLE local_only_pods(pod_id TEXT PRIMARY KEY REFERENCES pods(id) ON DELETE CASCADE);
CREATE INDEX ready_events ON accepted_events(state,pod_id,sequence);
CREATE INDEX mail_conversation ON mail_items(pod_id,conversation);
CREATE INDEX group_members ON pod_memberships(group_id);
CREATE UNIQUE INDEX workflow_active ON workflow_runs(workflow_id) WHERE finished_at IS NULL;
CREATE INDEX control_changes_conversation ON control_changes(conversation_id);
CREATE INDEX chat_message_history ON chat_message_context(conversation_id,revision);
CREATE INDEX effects_run ON effect_ledger(run_id);
CREATE INDEX runs_retention ON runs(pod_id,started_at DESC);
CREATE INDEX accepted_events_run ON accepted_events(run_id);
CREATE INDEX workflow_nodes_run ON workflow_nodes(run_id);
CREATE INDEX graph_items_key ON graph_items(workflow_id, key);
CREATE INDEX graph_deliveries_pending ON graph_deliveries(node, state);
CREATE INDEX graph_item_events_key ON graph_item_events(workflow_id, key, id);
CREATE INDEX graph_gate_batches_open ON graph_gate_batches(workflow_id, gate, state);
CREATE UNIQUE INDEX network_effect_execution_guard ON network_effect_attempts(logical_action_key) WHERE state!='confirmed_not_applied';
CREATE INDEX network_identity_retention ON network_event_identities(network_id,retain_until);
CREATE INDEX network_delivery_ready ON network_deliveries(subscription_id,state,ready_at,accepted_at,id);
CREATE INDEX network_delivery_case ON network_deliveries(network_id,case_id,case_revision,state);
CREATE INDEX network_delivery_run ON network_deliveries(run_id,state);
CREATE INDEX workflow_call_fifo ON workflow_call_requests(workflow_id,state,created_at,id);
CREATE UNIQUE INDEX network_gate_one_step ON network_gate_task_attempts(task_id) WHERE state='running';
CREATE INDEX network_trace_cursor ON network_trace_events(network_id,id);
CREATE INDEX network_process_active ON network_process_previews(network_id,state,expires_at);
CREATE INDEX network_control_retry ON network_invocation_controls(retry_at,run_id) WHERE retry_at IS NOT NULL;
CREATE INDEX network_control_deadline ON network_invocation_controls(deadline,run_id) WHERE deadline IS NOT NULL;
CREATE INDEX network_control_pending_age ON network_deliveries(network_id,state,accepted_at);
CREATE INDEX network_control_invocation_state ON network_invocations(pod_id,state,run_id);
CREATE INDEX network_control_invocation_health ON network_invocations(network_id,state,run_id);
CREATE INDEX network_gate_pod_admission ON network_invocations(pod_id);
CREATE INDEX network_gate_due ON network_gate_controls(next_poll_at,task_id);
CREATE UNIQUE INDEX network_gate_item_held ON network_gate_items(delivery_id) WHERE outcome IN ('held','released','unknown');
CREATE INDEX data_index_lookup ON data_index_values(collection_id,schema_version,index_name,value_type,value_text,value_number,record_key);
CREATE INDEX workflow_call_state ON workflow_call_requests(state,workflow_id);
CREATE INDEX workflow_call_execution ON workflow_call_requests(workflow_run_id);
CREATE INDEX workflow_call_delivery ON workflow_call_controls(delivery_state,next_delivery_poll_at,request_id);
CREATE INDEX network_choices_waiting ON network_choices(network_id,network_revision,decided_at);
CREATE INDEX inbox_outbox_due ON inbox_outbox(state, next_at);
CREATE INDEX pod_grants_coverage ON pod_grants(pod_id, cli_id, state);
CREATE INDEX pod_grants_network ON pod_grants(network_id, state);
COMMIT;
