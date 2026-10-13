import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { tagLimits } from '@openape/pods-protocol'
import { StorageError } from './errors.ts'
import { baselineSchema, schemaVersion } from './schema.ts'

/**
 * One-way conversion of a schema-47 profile into the current schema (issue 1465). It refuses before any change while legacy
 * network work is open, archives every row of the retired network runtime unchanged in legacy_records (verified by
 * count and digest), carries archive effects into the generalized effect ledger and member checkpoints into each
 * Pod's private state, rebuilds the tables whose definition changed and records a conversion receipt.
 * It runs inside the caller's transaction with foreign keys off, after the verified pre-upgrade backup.
 */

/** Every table of schema 47 that schema 48 no longer has; their rows survive only as inert history. */
export const retiredTables = ['network_sandbox_resources', 'automation_descriptions', 'networks', 'network_revisions', 'network_members', 'network_subscriptions', 'composition_config', 'network_checkpoints', 'network_source_clocks', 'network_scheduler_state', 'network_runtime_status', 'network_maintenance_status', 'network_process_previews', 'network_trace_events', 'network_cases', 'network_case_revisions', 'network_case_sources', 'network_events', 'network_event_identities', 'network_deliveries', 'network_queue_counts', 'network_joins', 'network_join_inputs', 'network_choices', 'network_invocations', 'network_invocation_controls', 'network_effect_attempts', 'network_effect_receipts', 'network_gate_tasks', 'network_gate_task_attempts', 'network_gate_attempt_controls', 'network_gate_controls', 'network_gate_items', 'network_gate_item_grants', 'data_collections', 'data_collection_versions', 'data_permissions', 'data_records', 'data_record_revisions', 'data_record_provenance', 'data_index_values', 'network_data_staging', 'artifact_scopes', 'artifacts', 'artifact_permissions', 'artifact_references', 'network_artifact_staging'] as const

/** Digests of the exact schema-46, schema-47 and schema-48 objects; a converted database must be one of them. */
const knownSchemas: Record<number, { objects: number, digest: string }> = {
  46: { objects: 147, digest: '4e022a881674f2f188a0a8397e0068e2d4e49147593ece1b813f61d855c41d1f' },
  47: { objects: 148, digest: '220a37d6c30b66ccf0ca88302791f006b3cd38e1290635b5f1ad448d3218901c' },
  48: { objects: 104, digest: '48af432be41c9c98cf89ea081c326ea156775bde3e73c1dd06fadda60ed1e7d9' },
}
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

function objects(database: DatabaseSync): { type: string, name: string, sql: string }[] {
  return database.prepare('SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE \'sqlite_%\' ORDER BY type,name').all() as { type: string, name: string, sql: string }[]
}

export function assertKnownSchema(database: DatabaseSync, version: number): void {
  const expected = knownSchemas[version]
  const actual = objects(database)
  if (!expected || actual.length !== expected.objects || sha256(JSON.stringify(actual)) !== expected.digest) throw new StorageError('invalid-data', `This database does not have the schema ${version} it declares`)
}

interface Statement { kind: 'table' | 'index', name: string, table: string, sql: string }
let baseline: Statement[] | undefined
/** The baseline split into its statements, each with the table it belongs to. */
function statements(): Statement[] {
  baseline ??= baselineSchema.split(';').map(part => part.split('\n').filter(line => !line.trim().startsWith('--')).join('\n').trim()).filter(Boolean).map((sql) => {
    const match = /^CREATE (?:UNIQUE )?(TABLE|INDEX) (\w+)(?: ON (\w+))?/.exec(sql)
    if (!match) throw new Error('Unreadable baseline statement')
    return { kind: match[1] === 'TABLE' ? 'table' as const : 'index' as const, name: match[2]!, table: match[3] ?? match[2]!, sql }
  })
  return baseline
}

const count = (database: DatabaseSync, sql: string): number => Number(Object.values(database.prepare(sql).get() ?? { count: 0 })[0] ?? 0)
const columns = (database: DatabaseSync, table: string): string[] => (database.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map(column => column.name)
const rowObject = (database: DatabaseSync, table: string) => `json_object(${columns(database, table).map(column => `'${column}',"${column}"`).join(',')})`

/** Open legacy work that no safe mapping exists for; any of it stops the conversion before a change. */
const blockers: [string, string][] = [
  ['running or uncertain network invocations', 'SELECT count(*) FROM network_invocations WHERE state IN (\'running\',\'stopping\',\'interrupted\',\'unknown\')'],
  ['open network deliveries', 'SELECT count(*) FROM network_deliveries WHERE state IN (\'pending\',\'claimed\',\'retry_wait\',\'blocked\',\'unknown\')'],
  ['undecided owner choices', 'SELECT count(*) FROM network_choices WHERE option_key IS NULL'],
  ['open or uncertain approval batches', 'SELECT count(*) FROM network_gate_tasks WHERE state IN (\'preparing\',\'pending\',\'consuming\',\'unknown\')'],
  ['archive moves with an unknown outcome', 'SELECT count(*) FROM network_effect_attempts WHERE state IN (\'intent\',\'unknown\')'],
  ['pending joins', 'SELECT count(*) FROM network_joins WHERE state=\'pending\''],
  ['staged network data', 'SELECT (SELECT count(*) FROM network_data_staging)+(SELECT count(*) FROM network_artifact_staging)'],
  ['network collection records or artifacts', 'SELECT (SELECT count(*) FROM data_records)+(SELECT count(*) FROM artifacts)'],
  ['network package imports in progress', 'SELECT count(*) FROM portable_imports WHERE (state IN (\'staged\',\'committed\') AND json_array_length(manifest,\'$.compositions\')>0) OR (state=\'completed\' AND archive_hash IS NOT NULL)'],
  ['held or uncertain approval items', 'SELECT count(*) FROM network_gate_items WHERE outcome IN (\'held\',\'unknown\')'],
  ['running approval steps', 'SELECT count(*) FROM network_gate_task_attempts WHERE state IN (\'running\',\'interrupted\')'],
  ['scheduled retries or reviews of failed invocations', 'SELECT count(*) FROM network_invocation_controls WHERE (retry_at IS NOT NULL AND retry_consumed_at IS NULL) OR review_required=1'],
  ['active network-scoped grants', 'SELECT count(*) FROM pod_grants WHERE network_id IS NOT NULL AND state IN (\'pending\',\'approved\')'],
]

export interface ConversionReceipt { from: 47, archived: Record<string, { rows: number, digest: string }>, effects: number, checkpoints: number, rebuilt: string[], at: string }

function archive(database: DatabaseSync, source: string, table: string, where = '1'): { rows: number, digest: string } {
  const body = rowObject(database, table)
  const original = database.prepare(`SELECT ${body} AS body FROM "${table}" WHERE ${where} ORDER BY rowid`).all().map(row => String(row.body))
  database.exec(`INSERT INTO legacy_records(source,row_id,body) SELECT '${source}',rowid,${body} FROM "${table}" WHERE ${where}`)
  const archived = database.prepare('SELECT body FROM legacy_records WHERE source=? ORDER BY row_id').all(source).map(row => String(row.body))
  const digest = sha256(original.join('\n'))
  if (archived.length !== original.length || sha256(archived.join('\n')) !== digest) throw new StorageError('invalid-data', `Archiving ${table} lost or changed rows`)
  return { rows: original.length, digest }
}

/** Read-only: refuses a database whose legacy network work cannot be converted safely, before anything is copied. */
export function assertNoOpenNetworkWork(database: DatabaseSync): void {
  const open = blockers.map(([label, sql]) => [label, count(database, sql)] as const).filter(([, total]) => total > 0)
  if (open.length) throw new StorageError('conversion-blocked', `The network runtime still holds ${open.map(([label, total]) => `${total} ${label}`).join(', ')}. Open the previous version of OpenApe Pods, finish or reconcile them, then update again; nothing was changed.`)
}

export function convert47(database: DatabaseSync): ConversionReceipt {
  assertKnownSchema(database, 47)
  assertNoOpenNetworkWork(database)
  const target = statements()
  const existing = new Set((database.prepare('SELECT name FROM sqlite_schema WHERE type=\'table\'').all() as { name: string }[]).map(row => row.name))
  const renamed: Record<string, string> = { owners: 'network_owners' }
  // New tables first: history, effects and the shared data model.
  for (const statement of target.filter(item => !existing.has(item.table) && !renamed[item.table])) database.exec(statement.sql)
  database.exec('INSERT INTO data_sequence VALUES(1,0)')
  const archived: ConversionReceipt['archived'] = {}
  for (const table of retiredTables) archived[table] = archive(database, table, table)
  archived.pod_grants = archive(database, 'pod_grants', 'pod_grants', 'network_id IS NOT NULL')
  archived.pod_sandbox = archive(database, 'pod_sandbox', 'pod_sandbox', 'source!=\'pod\'')
  archived.pod_sandbox_deny = archive(database, 'pod_sandbox_deny', 'pod_sandbox_deny', 'source!=\'pod\'')
  archived.item_tags = archive(database, 'item_tags', 'item_tags', 'id IN (SELECT id FROM networks)')
  // Archive moves keep their identities, intents and receipts, so a moved message is never moved again.
  database.exec(`INSERT INTO effect_attempts SELECT a.logical_action_key,a.attempt,i.pod_id,a.run_id,'mail.archive',a.input_hash,a.state,
    json_object('legacy',1,'networkId',a.network_id,'caseId',a.case_id,'caseRevision',a.case_revision,'manifestHash',a.manifest_hash),a.created_at
    FROM network_effect_attempts a JOIN network_invocations i ON i.run_id=a.run_id`)
  database.exec('INSERT INTO effect_receipts SELECT logical_action_key,attempt,sequence,outcome,body,created_at FROM network_effect_receipts')
  const effects = count(database, 'SELECT count(*) FROM effect_attempts')
  if (effects !== count(database, 'SELECT count(*) FROM network_effect_attempts')) throw new StorageError('invalid-data', 'An archive effect has no invocation to name its Pod')
  // A member's network checkpoint is its private state; the Pod continues from it. Its replaced standalone state stays history.
  archived.checkpoints = archive(database, 'checkpoints', 'checkpoints', 'pod_id IN (SELECT pod_id FROM network_checkpoints)')
  const checkpoints = database.prepare('UPDATE checkpoints SET revision=revision+1,body=(SELECT body FROM network_checkpoints n WHERE n.pod_id=checkpoints.pod_id) WHERE pod_id IN (SELECT pod_id FROM network_checkpoints)').run().changes
  // Network tags were shown on members as inherited; members keep them as their own labels.
  for (const row of database.prepare(`SELECT m.pod_id,t.tags FROM network_members m JOIN item_tags t ON t.id=m.network_id WHERE m.pod_id IN (SELECT id FROM pods)`).all()) {
    const own = database.prepare('SELECT tags,revision FROM item_tags WHERE id=?').get(row.pod_id as string)
    const tags = [...new Set([...(own ? JSON.parse(String(own.tags)) as string[] : []), ...JSON.parse(String(row.tags)) as string[]])].slice(0, tagLimits.perItem)
    database.prepare('INSERT INTO item_tags(id,tags,revision,updated_at) VALUES(?,?,1,?) ON CONFLICT(id) DO UPDATE SET tags=excluded.tags,revision=revision+1,updated_at=excluded.updated_at').run(row.pod_id as string, JSON.stringify(tags), Date.now())
  }
  database.exec('DELETE FROM item_tags WHERE id IN (SELECT id FROM networks)')
  // Journal receipts of the retired networks MCP action hold no work; an unfinished one is closed, never resumed.
  database.exec('UPDATE master_actions SET state=\'interrupted\',error=\'Network administration was retired with issue 1465\' WHERE id LIKE \'codex-network:%\' AND state=\'running\'')
  // Former members stayed out of the central workspace; they keep that privacy as standalone Pods.
  database.exec('INSERT OR IGNORE INTO local_only_pods SELECT pod_id FROM network_members WHERE pod_id IN (SELECT id FROM pods) UNION SELECT pod_id FROM network_invocations WHERE pod_id IN (SELECT id FROM pods)')
  // A network's denylist restricted its members; it becomes part of each member's own list instead of vanishing.
  for (const row of database.prepare('SELECT pod_id,json_group_array(paths) AS lists FROM pod_sandbox_deny WHERE source!=\'pod\' GROUP BY pod_id').all()) {
    const own = database.prepare('SELECT paths FROM pod_sandbox_deny WHERE pod_id=? AND source=\'pod\'').get(row.pod_id as string)
    const paths = [...new Set([own ? String(own.paths) : '[]', ...JSON.parse(String(row.lists)) as string[]].flatMap(list => JSON.parse(list) as string[]))]
    if (paths.length > 32) throw new StorageError('conversion-blocked', 'A former network member would exceed 32 denied paths; shorten the network denylist in the previous version, then update again; nothing was changed.')
    database.prepare('INSERT INTO pod_sandbox_deny VALUES(?,\'pod\',NULL,?) ON CONFLICT(pod_id,source) DO UPDATE SET paths=excluded.paths').run(row.pod_id as string, JSON.stringify(paths))
  }
  // A current network's owner level gave its members owner reach (any owner source won); the member keeps it as its own.
  database.exec(`INSERT INTO pod_sandbox SELECT s.pod_id,'pod',NULL,'owner' FROM pod_sandbox s JOIN networks n ON n.id=substr(s.source,9)
    WHERE s.source LIKE 'network:%' AND s.level='owner' AND n.state!='archived' AND n.revision=s.network_revision GROUP BY s.pod_id
    ON CONFLICT(pod_id,source) DO UPDATE SET level='owner'`)
  // Retained tables whose definition changed are rebuilt from the baseline, rowids included.
  const changed = target.filter(item => item.kind === 'table' && existing.has(item.table) && database.prepare('SELECT sql FROM sqlite_schema WHERE type=\'table\' AND name=?').get(item.name)?.sql !== item.sql).map(item => item.name)
  const rebuilt = [...changed, ...Object.keys(renamed).filter(name => !existing.has(name))]
  database.exec('PRAGMA legacy_alter_table=ON')
  for (const name of rebuilt) {
    const source = renamed[name] ?? name
    for (const index of database.prepare('SELECT name FROM sqlite_schema WHERE type=\'index\' AND tbl_name=? AND sql IS NOT NULL').all(source) as { name: string }[]) database.exec(`DROP INDEX "${index.name}"`)
    database.exec(`ALTER TABLE "${source}" RENAME TO "conversion_${name}"`)
  }
  database.exec('PRAGMA legacy_alter_table=OFF')
  for (const name of rebuilt) {
    for (const statement of target.filter(item => item.table === name)) database.exec(statement.sql)
    const kept = columns(database, name).filter(column => columns(database, `conversion_${name}`).includes(column))
    const list = ['rowid', ...kept.map(column => `"${column}"`)].join(',')
    const where = name === 'pod_sandbox' || name === 'pod_sandbox_deny' ? 'WHERE source=\'pod\'' : name === 'pod_grants' ? 'WHERE network_id IS NULL' : ''
    database.exec(`INSERT INTO "${name}"(${list}) SELECT ${list} FROM "conversion_${name}" ${where} ORDER BY rowid`)
    const total = count(database, `SELECT count(*) FROM "${name}"`) + (where ? archived[name]!.rows : 0)
    if (total !== count(database, `SELECT count(*) FROM "conversion_${name}"`)) throw new StorageError('invalid-data', `Rebuilding ${name} lost rows`)
    database.exec(`DROP TABLE "conversion_${name}"`)
  }
  for (const table of [...retiredTables].reverse()) database.exec(`DROP TABLE "${table}"`)
  assertBaseline(database)
  const receipt: ConversionReceipt = { from: 47, archived, effects, checkpoints: Number(checkpoints), rebuilt, at: new Date().toISOString() }
  database.prepare('INSERT INTO storage_receipts VALUES(?,\'conversion\',?,?)').run(randomUUID(), JSON.stringify(receipt), Date.now())
  return receipt
}

/** A converted database has exactly the baseline's objects and consistent references. */
function assertBaseline(database: DatabaseSync): void {
  const target = statements()
  const remaining = objects(database).filter(item => !target.some(statement => statement.name === item.name && statement.sql === item.sql))
  if (remaining.length || objects(database).length !== target.length) throw new StorageError('invalid-data', `The converted schema differs from schema ${schemaVersion}: ${remaining.map(item => item.name).join(', ') || 'missing objects'}`)
  if (database.prepare('PRAGMA foreign_key_check').get()) throw new StorageError('invalid-data', 'The conversion found an inconsistent reference')
}

/**
 * Schema 48 to 49 (issue 1468): object approvals also name exact program commands, whose titles show the complete
 * command. Only the CHECKs of action_approvals changed, so that table is rebuilt from the baseline with its rows and
 * rowids unchanged.
 * It runs inside the caller's transaction with foreign keys off, after the verified pre-upgrade backup.
 */
export function convert48(database: DatabaseSync): void {
  assertKnownSchema(database, 48)
  const rows = count(database, 'SELECT count(*) FROM action_approvals')
  database.exec('DROP INDEX action_approvals_state')
  database.exec('PRAGMA legacy_alter_table=ON')
  database.exec('ALTER TABLE action_approvals RENAME TO conversion_action_approvals')
  database.exec('PRAGMA legacy_alter_table=OFF')
  for (const statement of statements().filter(item => item.table === 'action_approvals')) database.exec(statement.sql)
  const list = ['rowid', ...columns(database, 'action_approvals').map(column => `"${column}"`)].join(',')
  database.exec(`INSERT INTO action_approvals(${list}) SELECT ${list} FROM conversion_action_approvals ORDER BY rowid`)
  if (count(database, 'SELECT count(*) FROM action_approvals') !== rows) throw new StorageError('invalid-data', 'Rebuilding action_approvals lost rows')
  database.exec('DROP TABLE conversion_action_approvals')
  assertBaseline(database)
  database.prepare('INSERT INTO storage_receipts VALUES(?,\'conversion\',?,?)').run(randomUUID(), JSON.stringify({ from: 48, rebuilt: ['action_approvals'], rows, at: new Date().toISOString() }), Date.now())
}

/** The tag table of schema 47, added to a schema-46 database before its conversion. */
export const schema47Tags = `CREATE TABLE item_tags(
  id TEXT PRIMARY KEY,
  tags TEXT NOT NULL CHECK(json_valid(tags) AND json_type(tags)='array'),
  revision INTEGER NOT NULL CHECK(revision>0),
  updated_at INTEGER NOT NULL
)`
