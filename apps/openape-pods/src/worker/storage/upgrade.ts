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

interface Column { name: string, type: string, pk: number }
function columns(database: DatabaseSync, table: string): Column[] {
  return database.prepare(`PRAGMA table_info("${table}")`).all() as unknown as Column[]
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
  assertSingleBinding(database)
  const legacy = database.prepare('SELECT type,name FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE \'sqlite_%\'').all()
  for (const index of legacy.filter(item => item.type === 'index')) database.exec(`DROP INDEX "${String(index.name)}"`)
  const tables = legacy.filter(item => item.type === 'table').map(item => String(item.name))
  // Legacy mode renames only the table itself; references to it disappear with the legacy tables below.
  database.exec('PRAGMA legacy_alter_table=ON')
  for (const table of tables) database.exec(`ALTER TABLE "${table}" RENAME TO "${legacyPrefix}${table}"`)
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
  for (const table of tables) database.exec(`DROP TABLE "${legacyPrefix}${table}"`)
  if (database.prepare('PRAGMA foreign_key_check').get()) throw new Error('Upgrade to schema 46 found an inconsistent reference')
}
