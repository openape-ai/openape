import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { normalizeTag, tagLimits } from '@openape/pods-protocol'
import { grantSummaryLimits, summaryLine } from '../../contracts/grant-summary.ts'
import { StorageError } from './errors.ts'
import { baselineSchema, schemaVersion } from './schema.ts'

/**
 * One-way conversion of a schema-47 profile into schema 48 (issue 1465); convertGroups continues to schema 49 and
 * convertApprovals to schema 50, convertApprovalSummaries to schema 51 and convertProgramAssignments to schema 52. It refuses before any change while legacy
 * network work is open, archives every row of the retired network runtime unchanged in legacy_records (verified by
 * count and digest), carries archive effects into the generalized effect ledger and member checkpoints into each
 * Pod's private state, rebuilds the tables whose definition changed and records a conversion receipt.
 * It runs inside the caller's transaction with foreign keys off, after the verified pre-upgrade backup.
 */

/** Every table of schema 47 that schema 48 no longer has; their rows survive only as inert history. */
export const retiredTables = ['network_sandbox_resources', 'automation_descriptions', 'networks', 'network_revisions', 'network_members', 'network_subscriptions', 'composition_config', 'network_checkpoints', 'network_source_clocks', 'network_scheduler_state', 'network_runtime_status', 'network_maintenance_status', 'network_process_previews', 'network_trace_events', 'network_cases', 'network_case_revisions', 'network_case_sources', 'network_events', 'network_event_identities', 'network_deliveries', 'network_queue_counts', 'network_joins', 'network_join_inputs', 'network_choices', 'network_invocations', 'network_invocation_controls', 'network_effect_attempts', 'network_effect_receipts', 'network_gate_tasks', 'network_gate_task_attempts', 'network_gate_attempt_controls', 'network_gate_controls', 'network_gate_items', 'network_gate_item_grants', 'data_collections', 'data_collection_versions', 'data_permissions', 'data_records', 'data_record_revisions', 'data_record_provenance', 'data_index_values', 'network_data_staging', 'artifact_scopes', 'artifacts', 'artifact_permissions', 'artifact_references', 'network_artifact_staging'] as const

/** Digests of the exact schema-46 to schema-51 objects; a converted database must be one of them. */
const knownSchemas: Record<number, { objects: number, digest: string }> = {
  46: { objects: 147, digest: '4e022a881674f2f188a0a8397e0068e2d4e49147593ece1b813f61d855c41d1f' },
  47: { objects: 148, digest: '220a37d6c30b66ccf0ca88302791f006b3cd38e1290635b5f1ad448d3218901c' },
  48: { objects: 104, digest: '48af432be41c9c98cf89ea081c326ea156775bde3e73c1dd06fadda60ed1e7d9' },
  49: { objects: 100, digest: '601fc34efb6fd577153621c2c2555cb858225ba6e647b9252e63f5dd9c83b82a' },
  50: { objects: 100, digest: '8ec6f0e1541245e95949f05a13c020855a2c8eb1fa8f9d12f369245563cff679' },
  51: { objects: 100, digest: '7c7012332cba58f01ba7ef168d48763c44ebb745dbcf9b1931d729d6ef8c7a5f' },
}

/** Schema 50 differs from the current baseline only in the summary columns of action_approvals (issue 1473). */
const schema51Approvals: [current: string, previous: string][] = [
  ['title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),\n  description TEXT CHECK(description IS NULL OR length(description)<=2000),\n  link TEXT CHECK(link IS NULL OR length(link) BETWEEN 1 AND 2048),', 'title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 720),'],
]
/** Schema 49 differs from schema 50 only in two CHECKs of action_approvals (issue 1468). */
const schema50Approvals: [current: string, previous: string][] = [
  ['action TEXT NOT NULL CHECK(action IN (\'mail.archive\',\'program.run\')),', 'action TEXT NOT NULL CHECK(action IN (\'mail.archive\')),'],
  ['title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 720),', 'title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),'],
]
function previousSchema(schema: string, changes: [current: string, previous: string][]): string {
  return changes.reduce((result, [current, previous]) => {
    if (result.split(current).length !== 2) throw new Error('The baseline lacks a known approval schema change')
    return result.replace(current, previous)
  }, schema)
}
/** The complete schema 50, the target of the conversion from schema 49. */
export const schema50 = previousSchema(baselineSchema, schema51Approvals)
/** The complete schema 49, the target of the older conversions before the approvals step. */
export const schema49 = previousSchema(schema50, schema50Approvals)

/** The owner groups of schemas 46 to 48; schema 49 keeps them as tags (issue 1468). */
export const schema48Groups = `CREATE TABLE pod_organization(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
CREATE TABLE pod_groups(id TEXT PRIMARY KEY, name TEXT NOT NULL, collapsed INTEGER NOT NULL CHECK(collapsed IN (0,1)));
CREATE TABLE pod_memberships(
  pod_id TEXT PRIMARY KEY REFERENCES pods(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES pod_groups(id) ON DELETE CASCADE
);
CREATE INDEX group_members ON pod_memberships(group_id);`
const groupTables = ['pod_memberships', 'pod_groups', 'pod_organization'] as const
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
const parsed = new Map<string, Statement[]>()
/** A schema split into its statements, each with the table it belongs to. */
function statements(schema: string): Statement[] {
  const cached = parsed.get(schema)
  if (cached) return cached
  const result = schema.split(';').map(part => part.split('\n').filter(line => !line.trim().startsWith('--')).join('\n').trim()).filter(Boolean).map((sql) => {
    const match = /^CREATE (?:UNIQUE )?(TABLE|INDEX) (\w+)(?: ON (\w+))?/.exec(sql)
    if (!match) throw new Error('Unreadable baseline statement')
    return { kind: match[1] === 'TABLE' ? 'table' as const : 'index' as const, name: match[2]!, table: match[3] ?? match[2]!, sql }
  })
  parsed.set(schema, result)
  return result
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
  // Schema 48 still had the owner groups; convertGroups retires them afterwards.
  const target = statements(`${schema49};${schema48Groups}`)
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
  const remaining = objects(database).filter(item => !target.some(statement => statement.name === item.name && statement.sql === item.sql))
  if (remaining.length || objects(database).length !== target.length) throw new StorageError('invalid-data', `The converted schema differs from schema 48: ${remaining.map(item => item.name).join(', ') || 'missing objects'}`)
  if (database.prepare('PRAGMA foreign_key_check').get()) throw new StorageError('invalid-data', 'The conversion found an inconsistent reference')
  const receipt: ConversionReceipt = { from: 47, archived, effects, checkpoints: Number(checkpoints), rebuilt, at: new Date().toISOString() }
  database.prepare('INSERT INTO storage_receipts VALUES(?,\'conversion\',?,?)').run(randomUUID(), JSON.stringify(receipt), Date.now())
  return receipt
}

/** The tag a group name becomes: lowercase words joined by hyphens, cut to the tag length; null without a letter or digit. */
export function groupTag(name: string): string | null {
  const words = name.normalize('NFC').toLocaleLowerCase('de').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+/, '')
  const tag = words.slice(0, tagLimits.length).replace(/-+$/, '')
  return tag ? normalizeTag(tag) : null
}

export interface GroupsReceipt {
  from: 48
  archived: Record<string, { rows: number, digest: string }>
  /** Pods that carry each tag because of their group. */
  tags: Record<string, number>
  /** Memberships that could not become a tag; they survive in legacy_records and the pre-upgrade backup. */
  skipped: { podId: string, group: string, reason: 'no-tag' | 'tag-limit' }[]
  at: string
}

/**
 * Schema 48 to 49 (issue 1468): groups and tags classified the same Pods, so each membership becomes a tag of the
 * group name on its Pod, the group rows are archived unchanged in legacy_records and the group tables are dropped.
 * It runs inside the caller's transaction with foreign keys off, after the verified pre-upgrade backup.
 */
export function convertGroups(database: DatabaseSync): GroupsReceipt {
  assertKnownSchema(database, 48)
  const archived: GroupsReceipt['archived'] = {}
  for (const table of groupTables) archived[table] = archive(database, table, table)
  const tags: GroupsReceipt['tags'] = {}
  const skipped: GroupsReceipt['skipped'] = []
  const migrated: [string, string][] = []
  const memberships = database.prepare('SELECT m.pod_id,g.name FROM pod_memberships m JOIN pod_groups g ON g.id=m.group_id ORDER BY m.rowid').all()
  for (const row of memberships) {
    const podId = String(row.pod_id); const group = String(row.name)
    const tag = groupTag(group)
    if (!tag) { skipped.push({ podId, group, reason: 'no-tag' }); continue }
    const own = database.prepare('SELECT tags FROM item_tags WHERE id=?').get(podId)
    const current = own ? JSON.parse(String(own.tags)) as string[] : []
    if (!current.includes(tag) && current.length >= tagLimits.perItem) { skipped.push({ podId, group, reason: 'tag-limit' }); continue }
    if (!current.includes(tag)) database.prepare('INSERT INTO item_tags(id,tags,revision,updated_at) VALUES(?,?,1,?) ON CONFLICT(id) DO UPDATE SET tags=excluded.tags,revision=revision+1,updated_at=excluded.updated_at').run(podId, JSON.stringify([...current, tag]), Date.now())
    tags[tag] = (tags[tag] ?? 0) + 1
    migrated.push([podId, tag])
  }
  const tagged = database.prepare('SELECT 1 FROM item_tags t, json_each(t.tags) j WHERE t.id=? AND j.value=?')
  if (migrated.some(([podId, tag]) => !tagged.get(podId, tag))) throw new StorageError('invalid-data', 'A group membership did not become a tag')
  for (const table of groupTables) database.exec(`DROP TABLE "${table}"`)
  assertSchema(database, schema49, 49)
  const receipt: GroupsReceipt = { from: 48, archived, tags, skipped, at: new Date().toISOString() }
  database.prepare('INSERT INTO storage_receipts VALUES(?,\'conversion\',?,?)').run(randomUUID(), JSON.stringify(receipt), Date.now())
  return receipt
}

/** A converted database has exactly the objects of `schema` and consistent references. */
function assertSchema(database: DatabaseSync, schema: string, version: number): void {
  const target = statements(schema)
  const remaining = objects(database).filter(item => !target.some(statement => statement.name === item.name && statement.sql === item.sql))
  if (remaining.length || objects(database).length !== target.length) throw new StorageError('invalid-data', `The converted schema differs from schema ${version}: ${remaining.map(item => item.name).join(', ') || 'missing objects'}`)
  if (database.prepare('PRAGMA foreign_key_check').get()) throw new StorageError('invalid-data', 'The conversion found an inconsistent reference')
}

/**
 * Schema 49 to 50 (issue 1468): object approvals also name exact program commands, whose titles show the complete
 * command. Only the CHECKs of action_approvals changed, so that table is rebuilt from the baseline with its rows and
 * rowids unchanged. It runs inside the caller's transaction with foreign keys off, after the verified pre-upgrade backup.
 */
export function convertApprovals(database: DatabaseSync): void {
  assertKnownSchema(database, 49)
  const rows = count(database, 'SELECT count(*) FROM action_approvals')
  database.exec('DROP INDEX action_approvals_state')
  database.exec('PRAGMA legacy_alter_table=ON')
  database.exec('ALTER TABLE action_approvals RENAME TO conversion_action_approvals')
  database.exec('PRAGMA legacy_alter_table=OFF')
  for (const statement of statements(schema50).filter(item => item.table === 'action_approvals')) database.exec(statement.sql)
  const list = ['rowid', ...columns(database, 'action_approvals').map(column => `"${column}"`)].join(',')
  database.exec(`INSERT INTO action_approvals(${list}) SELECT ${list} FROM conversion_action_approvals ORDER BY rowid`)
  if (count(database, 'SELECT count(*) FROM action_approvals') !== rows) throw new StorageError('invalid-data', 'Rebuilding action_approvals lost rows')
  database.exec('DROP TABLE conversion_action_approvals')
  assertSchema(database, schema50, 50)
  database.prepare('INSERT INTO storage_receipts VALUES(?,\'conversion\',?,?)').run(randomUUID(), JSON.stringify({ from: 49, rebuilt: ['action_approvals'], rows, at: new Date().toISOString() }), Date.now())
}

/**
 * Schema 50 to 51 (issue 1473): an approval carries the script's summary (title, description, link) instead of a
 * title composed by the desktop. The table is rebuilt with its rows and rowids; a former title longer than one summary
 * title keeps its shortened first part as title and its complete text as description, so nothing the owner read is
 * lost. Requests already at the IdP keep their grants, whose summaries the IdP migrates itself. It runs inside the
 * caller's transaction with foreign keys off, after the verified pre-upgrade backup.
 */
export function convertApprovalSummaries(database: DatabaseSync): void {
  assertKnownSchema(database, 50)
  const rows = count(database, 'SELECT count(*) FROM action_approvals')
  database.exec('DROP INDEX action_approvals_state')
  database.exec('PRAGMA legacy_alter_table=ON')
  database.exec('ALTER TABLE action_approvals RENAME TO conversion_action_approvals')
  database.exec('PRAGMA legacy_alter_table=OFF')
  for (const statement of statements(baselineSchema).filter(item => item.table === 'action_approvals')) database.exec(statement.sql)
  const previous = columns(database, 'conversion_action_approvals')
  const list = ['rowid', ...previous, 'description', 'link'].map(column => `"${column}"`).join(',')
  const insert = database.prepare(`INSERT INTO action_approvals(${list}) VALUES(${['rowid', ...previous, 'description', 'link'].map(() => '?').join(',')})`)
  let shortened = 0
  for (const row of database.prepare(`SELECT rowid,${previous.map(column => `"${column}"`).join(',')} FROM conversion_action_approvals ORDER BY rowid`).all()) {
    const former = String(row.title)
    const title = summaryLine(former, grantSummaryLimits.title)
    if (title !== former) shortened++
    insert.run(row.rowid as number, ...previous.map(column => (column === 'title' ? title : row[column]) as string | number | null), title === former ? null : former, null)
  }
  if (count(database, 'SELECT count(*) FROM action_approvals') !== rows) throw new StorageError('invalid-data', 'Rebuilding action_approvals lost rows')
  database.exec('DROP TABLE conversion_action_approvals')
  assertSchema(database, baselineSchema, schemaVersion)
  database.prepare('INSERT INTO storage_receipts VALUES(?,\'conversion\',?,?)').run(randomUUID(), JSON.stringify({ from: 50, rebuilt: ['action_approvals'], rows, shortened, at: new Date().toISOString() }), Date.now())
}

/** What a schema-51 program assignment kept about its Shapes adapter (issue 1473, revision 3). */
export const retiredProgramFields = ['adapterPath', 'adapterHash', 'registry', 'cliVersion', 'adapter', 'commands'] as const

/**
 * Schema 51 to 52 (issue 1473, revision 4): programs are assigned by path, file hash and optional runtime descriptor;
 * the IdP alone resolves their commands. The adapter fields leave every program assignment without owner action, and
 * everything else stays, including the command name (cliId) the program was assigned with, so grants for its exact
 * commands keep matching. Only resource configurations change; the tables stay as they are. It runs inside the
 * caller's transaction, after the verified pre-upgrade backup.
 */
export function convertProgramAssignments(database: DatabaseSync): void {
  assertKnownSchema(database, 51)
  const update = database.prepare('UPDATE resources SET configuration=? WHERE id=?')
  let programs = 0; let converted = 0
  for (const row of database.prepare('SELECT id,configuration FROM resources WHERE json_extract(configuration,\'$.type\')=\'program\' ORDER BY rowid').all()) {
    programs++
    const configuration = JSON.parse(String(row.configuration)) as Record<string, unknown>
    if (typeof configuration.cliId !== 'string' || typeof configuration.executable !== 'string' || typeof configuration.executableHash !== 'string') throw new StorageError('invalid-data', `Program assignment ${String(row.id)} has no command name, executable or file hash`)
    const kept = Object.fromEntries(Object.entries(configuration).filter(([key]) => !(retiredProgramFields as readonly string[]).includes(key)))
    if (Object.keys(kept).length === Object.keys(configuration).length) continue
    update.run(JSON.stringify(kept), String(row.id))
    converted++
  }
  assertSchema(database, baselineSchema, schemaVersion)
  database.prepare('INSERT INTO storage_receipts VALUES(?,\'conversion\',?,?)').run(randomUUID(), JSON.stringify({ from: 51, programs, converted, removed: retiredProgramFields, at: new Date().toISOString() }), Date.now())
}

/** The tag table of schema 47, added to a schema-46 database before its conversion. */
export const schema47Tags = `CREATE TABLE item_tags(
  id TEXT PRIMARY KEY,
  tags TEXT NOT NULL CHECK(json_valid(tags) AND json_type(tags)='array'),
  revision INTEGER NOT NULL CHECK(revision>0),
  updated_at INTEGER NOT NULL
)`
