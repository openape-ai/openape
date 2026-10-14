import type { DatabaseSync } from 'node:sqlite'
import { assertKnownSchema, assertNoOpenNetworkWork, convert47, convertApprovalSummaries, convertApprovals, convertGroups, convertProgramAssignments, schema47Tags } from './convert.ts'
import { schemaVersion } from './schema.ts'

/** The oldest schema this version converts: the one the October 2026 releases wrote since issue 1455. */
export const upgradableSchema = 46

export function assertSupportedSchema(version: number): void {
  if (version > schemaVersion) throw new Error(`Database schema ${version} needs a newer application`)
  if (version > 0 && version < upgradableSchema) throw new Error(`This data has schema ${version} and was created by an older OpenApe Pods version. Open or restore it with that version first and update it to schema ${upgradableSchema}; this version starts at schema ${upgradableSchema}.`)
}

/** Read-only: refuses a database that is not exactly the schema it declares or still holds open network work. */
export function assertUpgradable(database: DatabaseSync, version: number): void {
  assertKnownSchema(database, version)
  if (version < 48) assertNoOpenNetworkWork(database)
}

/**
 * Brings a schema-46 to schema-51 database to schema 52 inside the caller's transaction, with foreign keys off:
 * schema 46 gains the tag table of schema 47, the network runtime of schema 47 is converted, the owner groups of
 * schema 48 become tags, the approval table of schema 49 accepts program approvals, the approvals of schema 50 carry
 * summaries instead of composed titles, then the program assignments of schema 51 lose their adapter fields (convert.ts).
 */
export function upgradeToCurrent(database: DatabaseSync, version: number): void {
  if (version < upgradableSchema || version >= schemaVersion) throw new Error(`Database schema ${version} cannot be upgraded`)
  assertUpgradable(database, version)
  if (version === 46) database.exec(schema47Tags)
  if (version < 48) convert47(database)
  if (version < 49) convertGroups(database)
  if (version < 50) convertApprovals(database)
  if (version < 51) convertApprovalSummaries(database)
  convertProgramAssignments(database)
}
