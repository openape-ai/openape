import { parseOwner } from '@openape/pods-protocol'
import { DatabaseSync } from 'node:sqlite'
import { baselineSchema } from './schema.ts'

let expectedObjects: { type: string, name: string, sql: string }[] | undefined
function baselineObjects(): { type: string, name: string, sql: string }[] {
  if (expectedObjects) return expectedObjects
  const reference = new DatabaseSync(':memory:')
  try {
    reference.exec(baselineSchema)
    expectedObjects = reference.prepare('SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE \'sqlite_%\'').all() as { type: string, name: string, sql: string }[]
    return expectedObjects
  }
  finally { reference.close() }
}

/**
 * Every baseline table and index exists exactly as the baseline declares it. With `references`, as for an opened
 * backup, every stored reference and owner is checked as well.
 */
export function assertIntegrity(database: DatabaseSync, references = false): void {
  for (const expected of baselineObjects()) {
    const actual = database.prepare('SELECT sql FROM sqlite_schema WHERE type=? AND name=?').get(expected.type, expected.name)
    if (actual?.sql !== expected.sql) throw new Error(`Incomplete or altered storage: ${expected.name}`)
  }
  if (!references) return
  const broken = database.prepare('PRAGMA foreign_key_check').get()
  if (broken) throw new Error(`Invalid references: ${String(broken.table)}`)
  for (const owner of database.prepare('SELECT issuer,subject FROM owners').all()) parseOwner(owner)
}
