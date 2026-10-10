import type { DatabaseSync } from 'node:sqlite'
import { baselineSchema, schemaVersion } from './schema.ts'

/** The only schema this version upgrades: the one the October 2026 releases (up to issue 1455, M4) wrote. */
export const upgradableSchema = 45

export function assertSupportedSchema(version: number): void {
  if (version > schemaVersion) throw new Error(`Database schema ${version} needs a newer application`)
  if (version > 0 && version < upgradableSchema) throw new Error(`This data has schema ${version} and was created by an older OpenApe Pods version. Open or restore it with that version first and update it to schema ${upgradableSchema}; this version starts at schema ${upgradableSchema}.`)
}

/** Schema-46 tables whose schema-45 rows were stored under another name. */
const formerNames: Record<string, string> = { automation_descriptions: 'collection_descriptions' }
const legacyPrefix = 'schema45_'

/**
 * Every table and index a schema-45 database has, as the October 2026 releases created them. The upgrade only
 * touches these names and refuses a database with any other object, so no stored name ever reaches SQL text.
 */
const schema45Tables = new Set([
  'accepted_events', 'access_proposals', 'artifact_permissions', 'artifact_references', 'artifact_scopes',
  'artifacts', 'assignments', 'chat_active', 'chat_contexts', 'chat_conversations', 'chat_members',
  'chat_message_context', 'checkpoints', 'claims', 'collection_descriptions', 'composition_config', 'connections',
  'control_changes', 'control_runs', 'data_collection_versions', 'data_collections', 'data_index_values',
  'data_permissions', 'data_record_provenance', 'data_record_revisions', 'data_records', 'data_settings',
  'definition_config', 'definition_instance_requests', 'definition_update_drafts', 'deletion_jobs',
  'dependency_domains', 'dependency_sets', 'draft_packages', 'effect_ledger', 'execution_domains',
  'graph_deliveries', 'graph_gate_batches', 'graph_item_events', 'graph_items', 'inbox_outbox', 'instance_config',
  'instance_definition_bindings', 'local_only_pods', 'mail_contexts', 'mail_extractions', 'mail_inventory',
  'mail_items', 'mail_receipts', 'master_actions', 'master_contexts', 'master_creations', 'master_domains',
  'master_inputs', 'master_message_scopes', 'master_messages', 'master_session', 'network_artifact_staging',
  'network_case_revisions', 'network_case_sources', 'network_cases', 'network_checkpoints', 'network_choices',
  'network_data_staging', 'network_deliveries', 'network_effect_attempts', 'network_effect_receipts',
  'network_event_identities', 'network_events', 'network_gate_attempt_controls', 'network_gate_controls',
  'network_gate_item_grants', 'network_gate_items', 'network_gate_task_attempts', 'network_gate_tasks',
  'network_invocation_controls', 'network_invocations', 'network_join_inputs', 'network_joins',
  'network_maintenance_status', 'network_members', 'network_owners', 'network_process_previews',
  'network_queue_counts', 'network_revisions', 'network_runtime_status', 'network_sandbox_resources',
  'network_scheduler_state', 'network_source_clocks', 'network_subscriptions', 'network_trace_events',
  'network_trace_history', 'networks', 'onboarding', 'pod_chat_origins', 'pod_definition_sources',
  'pod_definition_versions', 'pod_definitions', 'pod_descriptions', 'pod_grants', 'pod_groups', 'pod_memberships',
  'pod_organization', 'pod_sandbox', 'pod_sandbox_deny', 'pod_variables', 'pods', 'portable_import_pods',
  'portable_imports', 'program_leases', 'recovery_reviews', 'reference_observations', 'remote_conversations',
  'remote_devices', 'remote_inbox', 'remote_outbox', 'remote_pods', 'remote_program_catalog',
  'remote_program_reviews', 'remote_registration', 'resource_aliases', 'resource_epochs', 'resources',
  'run_deletion_jobs', 'run_events', 'run_inputs', 'run_leases', 'runs', 'schedules', 'script_credential_approvals',
  'script_dependencies', 'script_drafts', 'scripts', 'secret_requests', 'settings', 'snapshot_sets',
  'source_derivations', 'sources', 'summary_domains', 'validations', 'workflow_attempts', 'workflow_call_controls',
  'workflow_call_permissions', 'workflow_call_requests', 'workflow_call_result_events', 'workflow_call_staging',
  'workflow_channels', 'workflow_gate_attempts', 'workflow_gate_poll_clocks', 'workflow_gates',
  'workflow_mail_audit', 'workflow_mail_batches', 'workflow_mail_participants', 'workflow_mail_pending',
  'workflow_mail_processed', 'workflow_mail_scopes', 'workflow_members', 'workflow_nodes', 'workflow_reservations',
  'workflow_revisions', 'workflow_runs', 'workflow_values', 'workflows',
])
const schema45Indexes = new Set([
  'accepted_events_run', 'chat_message_history', 'control_changes_conversation', 'data_index_lookup', 'effects_run',
  'graph_deliveries_pending', 'graph_gate_batches_open', 'graph_item_events_key', 'graph_items_key', 'group_members',
  'inbox_outbox_due', 'mail_conversation', 'network_choices_waiting', 'network_control_deadline',
  'network_control_invocation_health', 'network_control_invocation_state', 'network_control_pending_age',
  'network_control_retry', 'network_delivery_case', 'network_delivery_ready', 'network_delivery_run',
  'network_effect_execution_guard', 'network_gate_due', 'network_gate_item_held', 'network_gate_one_step',
  'network_gate_pod_admission', 'network_identity_retention', 'network_process_active', 'network_trace_cursor',
  'pod_grants_coverage', 'pod_grants_network', 'ready_events', 'runs_retention', 'workflow_active',
  'workflow_call_delivery', 'workflow_call_execution', 'workflow_call_fifo', 'workflow_call_state',
  'workflow_nodes_run',
])

// SQLite authorizer codes. Node 24.14 (also inside Electron 40) has DatabaseSync.setAuthorizer; @types/node lacks it.
const sqliteOk = 0; const sqliteDeny = 1; const sqliteAttach = 24
type AuthorizedDatabase = DatabaseSync & { setAuthorizer: (callback: ((action: number) => number) | null) => void }

interface Column { name: string, type: string, pk: number }
function columns(database: DatabaseSync, table: string): Column[] {
  return database.prepare(`PRAGMA table_info("${table}")`).all() as unknown as Column[]
}
/** A restored backup is untrusted: its schema must be exactly schema 45, without programs or other databases. */
function assertSchema45(database: DatabaseSync): void {
  const objects = database.prepare('SELECT type,name FROM sqlite_schema WHERE name NOT LIKE \'sqlite_%\' AND (type!=\'index\' OR sql IS NOT NULL)').all()
  const unexpected = objects.find(item => !(item.type === 'table' ? schema45Tables : item.type === 'index' ? schema45Indexes : new Set()).has(String(item.name)))
  if (unexpected || objects.length !== schema45Tables.size + schema45Indexes.size) throw new Error('This database does not have the schema 45 it declares')
  if (database.prepare('PRAGMA database_list').all().some(item => item.name !== 'main' && item.name !== 'temp')) throw new Error('This database does not have the schema 45 it declares')
}
function count(database: DatabaseSync, table: string): number {
  return Number(database.prepare(`SELECT count(*) AS count FROM "${table}"`).get()!.count)
}

/**
 * Schema 45 stored the definition binding of a network member twice: in instance_definition_bindings and again in
 * network_members. Schema 46 keeps only the binding; the upgrade refuses copies that disagree instead of choosing one.
 */
function assertSingleBinding(database: DatabaseSync): void {
  const diverged = database.prepare(`SELECT m.pod_id FROM network_members m LEFT JOIN instance_definition_bindings b ON b.pod_id=m.pod_id
    WHERE b.pod_id IS NULL OR b.definition_id!=m.definition_id OR b.definition_version!=m.definition_version OR b.binding_revision!=m.binding_revision LIMIT 1`).get()
  if (diverged) throw new Error(`Network member ${String(diverged.pod_id)} has a binding that differs from its Pod; restore the previous version of OpenApe Pods and review the network`)
}

/**
 * Rebuilds a schema-45 database as the schema-46 baseline inside the caller's transaction, with foreign keys off.
 * Every baseline table is created from its baseline statement and receives the retained columns of its schema-45
 * rows, rowids included (message sequences and description cursors refer to them). Tables and columns that
 * schema 46 no longer has are dropped with their rows; the pre-upgrade backup keeps them.
 */
export function upgradeToBaseline(database: DatabaseSync): void {
  assertSchema45(database)
  assertSingleBinding(database)
  // Nothing in the rebuild attaches a database; refuse it outright while the untrusted schema is open.
  const authorized = database as AuthorizedDatabase
  authorized.setAuthorizer(action => action === sqliteAttach ? sqliteDeny : sqliteOk)
  try { rebuild(database) }
  finally { authorized.setAuthorizer(null) }
}

function rebuild(database: DatabaseSync): void {
  for (const index of schema45Indexes) database.exec(`DROP INDEX ${index}`)
  const tables = [...schema45Tables]
  // Legacy mode renames only the table itself; references to it disappear with the legacy tables below.
  database.exec('PRAGMA legacy_alter_table=ON')
  for (const table of tables) database.exec(`ALTER TABLE ${table} RENAME TO ${legacyPrefix}${table}`)
  database.exec('PRAGMA legacy_alter_table=OFF')
  database.exec(baselineSchema)
  const baseline = database.prepare('SELECT name FROM sqlite_schema WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\' AND name NOT LIKE ?').all(`${legacyPrefix}%`).map(row => String(row.name))
  for (const table of baseline) {
    const source = formerNames[table] ?? table
    if (!tables.includes(source)) throw new Error(`Schema 45 lacks table ${source}`)
    const target = columns(database, table)
    const available = new Set(columns(database, `${legacyPrefix}${source}`).map(column => column.name))
    const missing = target.find(column => !available.has(column.name))
    if (missing) throw new Error(`Schema 45 lacks column ${source}.${missing.name}`)
    const keyed = target.filter(column => column.pk)
    const rowidAlias = keyed.length === 1 && keyed[0]!.type.toUpperCase() === 'INTEGER'
    const names = [...(rowidAlias ? [] : ['rowid']), ...target.map(column => `"${column.name}"`)].join(',')
    database.exec(`INSERT INTO "${table}"(${names}) SELECT ${names} FROM "${legacyPrefix}${source}" ORDER BY rowid`)
    if (count(database, table) !== count(database, `${legacyPrefix}${source}`)) throw new Error(`Upgrade of ${table} lost rows`)
    database.prepare('UPDATE sqlite_sequence SET seq=max(seq,(SELECT seq FROM sqlite_sequence WHERE name=?)) WHERE name=?').run(`${legacyPrefix}${source}`, table)
  }
  for (const table of tables) database.exec(`DROP TABLE ${legacyPrefix}${table}`)
  if (database.prepare('PRAGMA foreign_key_check').get()) throw new Error('Upgrade to schema 46 found an inconsistent reference')
}
