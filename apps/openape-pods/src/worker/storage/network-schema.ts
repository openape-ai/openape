import { networkRoutingSchema, networkRoutingTables } from './network-routing-schema.ts'
import { definitionSchema, definitionTables } from './definition-schema.ts'
import { aliasSchema, aliasTables, sharingSchema, sharingTables } from './sharing-schema.ts'
import { networkDataSchema, networkDataTables } from './network-data-schema.ts'
import { networkWorkflowSchema, networkWorkflowTables } from './network-workflow-schema.ts'
import { networkGateGrantSchema, networkGateGrantTables, networkGateSchema, networkGateTables } from './network-gate-schema.ts'
import { networkControlSchema, networkControlTables } from './network-control-schema.ts'
import { createHash } from 'node:crypto'
import { parseOwner } from '@openape/pods-protocol'
import { DatabaseSync } from 'node:sqlite'

export const networkSchema = `
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
CREATE UNIQUE INDEX network_effect_execution_guard ON network_effect_attempts(logical_action_key) WHERE state!='confirmed_not_applied';
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
CREATE INDEX network_identity_retention ON network_event_identities(network_id,retain_until);
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
CREATE INDEX network_delivery_ready ON network_deliveries(subscription_id,state,ready_at,accepted_at,id);
CREATE INDEX network_delivery_case ON network_deliveries(network_id,case_id,case_revision,state);
CREATE INDEX network_delivery_run ON network_deliveries(run_id,state);
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
CREATE INDEX workflow_call_fifo ON workflow_call_requests(workflow_id,state,created_at,id);
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
CREATE UNIQUE INDEX network_gate_one_step ON network_gate_task_attempts(task_id) WHERE state='running';
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
CREATE INDEX network_trace_cursor ON network_trace_events(network_id,id);
`

export const networkTables = Array.from(networkSchema.matchAll(/CREATE TABLE (\w+)\(/g), match => match[1]!)

const expectedSchemas = new Map<number, { type: string, name: string, sql: string }[]>()
function schemaObjects(version: number): { type: string, name: string, sql: string }[] {
  const cached = expectedSchemas.get(version)
  if (cached) return cached
  const reference = new DatabaseSync(':memory:')
  try {
    reference.exec(networkSchema + (version >= 29 ? networkControlSchema : '') + (version >= 30 ? networkGateSchema : '') + (version >= 31 ? networkDataSchema : '') + (version >= 32 ? networkWorkflowSchema : '') + (version >= 33 ? definitionSchema : '') + (version >= 34 ? sharingSchema : '') + (version >= 35 ? aliasSchema : '') + (version >= 36 ? networkRoutingSchema : '') + (version >= 40 ? networkGateGrantSchema : ''))
    const expectedSchema = reference.prepare('SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE \'sqlite_%\'').all() as { type: string, name: string, sql: string }[]
    expectedSchemas.set(version, expectedSchema)
    return expectedSchema
  }
  finally { reference.close() }
}

const networkBoundaryChecks = {
  membership: `SELECT 1 FROM network_members m JOIN networks n ON n.id=m.network_id LEFT JOIN pod_memberships p ON p.pod_id=m.pod_id JOIN pod_definitions d ON d.id=m.definition_id
    WHERE p.group_id IS NOT n.group_id OR d.owner_issuer!=n.owner_issuer OR d.owner_subject!=n.owner_subject
    OR EXISTS(SELECT 1 FROM workflow_members w WHERE w.pod_id=m.pod_id) LIMIT 1`,
  instanceBinding: `SELECT 1 FROM network_members m LEFT JOIN instance_definition_bindings b ON b.pod_id=m.pod_id
    WHERE b.pod_id IS NULL OR b.definition_id!=m.definition_id OR b.definition_version!=m.definition_version OR b.binding_revision!=m.binding_revision LIMIT 1`,
  invocationPod: `SELECT 1 FROM network_invocations i JOIN runs r ON r.id=i.run_id WHERE r.pod_id!=i.pod_id LIMIT 1`,
  effectCase: `SELECT 1 FROM network_effect_attempts e JOIN network_invocations i ON i.run_id=e.run_id JOIN network_cases c ON c.id=e.case_id WHERE c.network_id!=i.network_id LIMIT 1`,
  eventDefinition: `SELECT 1 FROM network_events e JOIN networks n ON n.id=e.network_id JOIN pod_definitions d ON d.id=e.definition_id WHERE d.owner_issuer!=n.owner_issuer OR d.owner_subject!=n.owner_subject LIMIT 1`,
  recordAuthor: `SELECT 1 FROM data_record_revisions r JOIN network_invocations i ON i.run_id=r.author_run_id JOIN networks n ON n.id=i.network_id JOIN data_collections c ON c.id=r.collection_id JOIN pod_definitions d ON d.id=r.definition_id
    WHERE c.owner_issuer!=n.owner_issuer OR c.owner_subject!=n.owner_subject OR c.group_id!=n.group_id OR d.owner_issuer!=n.owner_issuer OR d.owner_subject!=n.owner_subject LIMIT 1`,
  retainedIdentity: `SELECT 1 FROM network_event_identities i JOIN network_events e ON e.id=i.event_id WHERE i.network_id!=e.network_id OR i.payload_hash!=e.payload_hash OR i.schema_hash!=e.schema_hash LIMIT 1`,
  effectOutcome: `SELECT 1 FROM network_effect_attempts a WHERE a.state='confirmed_not_applied' AND EXISTS(SELECT 1 FROM network_effect_receipts r WHERE r.logical_action_key=a.logical_action_key AND r.attempt=a.attempt AND r.outcome='confirmed_applied') LIMIT 1`,
  gateAttempt: `SELECT 1 FROM network_gate_task_attempts a JOIN network_gate_tasks t ON t.id=a.task_id JOIN network_invocations i ON i.run_id=a.run_id WHERE t.network_id!=i.network_id OR t.pod_id!=i.pod_id OR i.execution_kind!='gate_maintenance' LIMIT 1`,
}

export function assertNetworkStorage(database: DatabaseSync, references = false): void {
  const version = Number(database.prepare('PRAGMA user_version').get()!.user_version)
  const controls = version >= 29
  for (const expected of schemaObjects(version)) {
    const actual = database.prepare('SELECT sql FROM sqlite_schema WHERE type=? AND name=?').get(expected.type, expected.name)
    if (actual?.sql !== expected.sql) throw new Error(`Incomplete or altered network storage: ${expected.name}`)
  }
  if (!references) return
  for (const table of [...networkTables, ...(controls ? networkControlTables : []), ...(version >= 30 ? networkGateTables : []), ...(version >= 31 ? networkDataTables : []), ...(version >= 32 ? networkWorkflowTables : []), ...(version >= 33 ? definitionTables : []), ...(version >= 34 ? sharingTables : []), ...(version >= 35 ? aliasTables : []), ...(version >= 36 ? networkRoutingTables : []), ...(version >= 40 ? networkGateGrantTables : [])]) {
    if (database.prepare(`PRAGMA foreign_key_check(${table})`).get()) throw new Error(`Invalid network references: ${table}`)
  }
  for (const owner of database.prepare('SELECT issuer,subject FROM network_owners').all()) parseOwner(owner)
  for (const [table, body, hash] of [['network_revisions', 'contract', 'content_hash'], ['network_events', 'payload', 'payload_hash'], ['workflow_revisions', 'definition', 'content_hash'], ['network_gate_tasks', 'manifest', 'manifest_hash'], ['workflow_call_requests', 'request', 'request_hash']]) {
    for (const row of database.prepare(`SELECT ${body} AS body,${hash} AS hash FROM ${table}`).iterate()) {
      if (createHash('sha256').update(String(row.body)).digest('hex') !== row.hash) throw new Error(`Invalid network content digest: ${table}`)
    }
  }
  if (controls) {
    const retry = database.prepare('SELECT 1 FROM network_invocation_controls c JOIN network_invocations i ON i.run_id=c.run_id JOIN network_invocations previous ON previous.run_id=c.retry_of JOIN network_invocation_controls p ON p.run_id=previous.run_id WHERE i.network_id!=previous.network_id OR i.pod_id!=previous.pod_id OR c.attempt!=p.attempt+1 LIMIT 1').get()
    if (retry) throw new Error('Invalid network retry lineage')
    const preview = database.prepare('SELECT 1 FROM network_invocation_controls c JOIN network_invocations i ON i.run_id=c.run_id JOIN network_process_previews p ON p.id=c.process_preview_id WHERE p.network_id!=i.network_id LIMIT 1').get()
    if (preview) throw new Error('Invalid network process preview scope')
  }
  if (version >= 30) {
    const gateItems = database.prepare(`SELECT 1 FROM network_gate_items item JOIN network_gate_tasks task ON task.id=item.task_id
      JOIN network_deliveries delivery ON delivery.id=item.delivery_id JOIN network_subscriptions subscription ON subscription.id=delivery.subscription_id
      JOIN network_events event ON event.id=item.event_id
      WHERE delivery.network_id!=task.network_id OR event.network_id!=task.network_id OR delivery.event_id!=item.event_id
        OR subscription.pod_id!=task.pod_id OR subscription.network_revision!=task.network_revision LIMIT 1`).get()
    if (gateItems) throw new Error('Invalid network gate item scope')
  }
  if (version >= 32) {
    for (const row of database.prepare('SELECT request,request_hash FROM workflow_call_staging').iterate()) {
      if (createHash('sha256').update(String(row.request)).digest('hex') !== row.request_hash) throw new Error('Invalid staged workflow call digest')
    }
    const permission = database.prepare('SELECT 1 FROM workflow_call_permissions p JOIN networks n ON n.id=p.network_id WHERE p.owner_issuer!=n.owner_issuer OR p.owner_subject!=n.owner_subject OR p.group_id!=n.group_id LIMIT 1').get()
    if (permission) throw new Error('Invalid workflow call permission scope')
  }
  if (version >= 36) {
    const choice = database.prepare(`SELECT 1 FROM network_choices c
      JOIN network_revisions r ON r.network_id=c.network_id AND r.revision=c.network_revision
      JOIN network_events e ON e.id=c.event_id LEFT JOIN network_events d ON d.id=c.result_event_id
      WHERE e.network_revision!=c.network_revision OR NOT EXISTS(
        SELECT 1 FROM json_each(r.contract,'$.routes') g WHERE json_extract(g.value,'$.key')=c.gate_key
          AND json_extract(g.value,'$.kind')='choose' AND json_extract(g.value,'$.takes')=e.channel
          AND (c.option_key IS NULL OR (d.network_revision=c.network_revision AND d.case_id=e.case_id AND d.case_revision=e.case_revision
            AND d.payload_hash=e.payload_hash AND EXISTS(SELECT 1 FROM json_each(g.value,'$.options') o
              WHERE json_extract(o.value,'$.key')=c.option_key AND json_extract(o.value,'$.channel')=d.channel)))) LIMIT 1`).get()
    if (choice) throw new Error('Invalid network choice scope')
  }
  for (const [name, query] of Object.entries(networkBoundaryChecks)) {
    if (database.prepare(query).get()) throw new Error(`Invalid network boundary: ${name}`)
  }
}
