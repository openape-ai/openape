import type { DatabaseSync } from 'node:sqlite'
import { assertKnownSchema, convert47, schema47Tags } from './convert.ts'
import { schemaVersion } from './schema.ts'

/** The oldest schema this version converts: the one the October 2026 releases wrote since issue 1455. */
export const upgradableSchema = 46

export function assertSupportedSchema(version: number): void {
  if (version > schemaVersion) throw new Error(`Database schema ${version} needs a newer application`)
  if (version > 0 && version < upgradableSchema) throw new Error(`This data has schema ${version} and was created by an older OpenApe Pods version. Open or restore it with that version first and update it to schema ${upgradableSchema}; this version starts at schema ${upgradableSchema}.`)
}

/** Read-only: refuses a database that is not exactly the schema it declares. */
export function assertUpgradable(database: DatabaseSync, version: number): void {
  assertKnownSchema(database, version)
}

/**
 * Brings a schema-46 or schema-47 database to schema 48 inside the caller's transaction, with foreign keys off:
 * schema 46 gains the tag table of schema 47, then the network runtime is converted (convert.ts).
 */
export function upgradeToCurrent(database: DatabaseSync, version: number): void {
  if (version !== 46 && version !== 47) throw new Error(`Database schema ${version} cannot be upgraded`)
  assertUpgradable(database, version)
  if (version === 46) database.exec(schema47Tags)
  convert47(database)
}
