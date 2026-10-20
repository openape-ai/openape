import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { assertCurrentScript } from '../../contracts/retired-storage.ts'
import { StorageError } from './errors.ts'

export const sharedTables = ['owner_questions', 'work_items', 'work_operations', 'data_entry_revisions', 'data_entries', 'data_readers', 'data_namespaces', 'data_sequence'] as const

/** Read-only preflight, also used for restored databases before the destructive transaction. */
export function assertSharedStorageUnused(database: DatabaseSync, root: string): void {
  if (database.prepare('SELECT 1 FROM run_leases LIMIT 1').get()) throw new StorageError('conversion-blocked', 'Stop all Pod runs before retiring shared storage')
  if (database.prepare('SELECT 1 FROM work_items WHERE state IN (\'claimed\',\'unknown\') LIMIT 1').get()) throw new StorageError('conversion-blocked', 'Reconcile claimed or uncertain shared work before updating')
  for (const row of database.prepare('SELECT p.id,s.hash,s.manifest FROM pods p JOIN scripts s ON s.pod_id=p.id AND s.hash=p.active_script WHERE p.lifecycle<>\'archived\'').all()) {
    try { assertCurrentScript(readFileSync(join(root, 'blobs', String(row.hash)), 'utf8'), JSON.parse(String(row.manifest))) }
    catch (error) { throw new StorageError('conversion-blocked', `Pod ${String(row.id)} prevents shared storage retirement: ${error instanceof Error ? error.message : String(error)}`) }
  }
}

/** Called inside the version upgrade transaction, after its verified private backup. */
export function retireSharedStorage(database: DatabaseSync): void {
  const removed = Object.fromEntries(sharedTables.map(table => [table, Number(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()!.count)]))
  for (const table of sharedTables) database.exec(`DROP TABLE ${table}`)
  database.prepare('INSERT INTO storage_receipts VALUES(?,\'conversion\',?,?)').run(randomUUID(), JSON.stringify({ from: 53, retired: 'shared-storage', removed, at: new Date().toISOString() }), Date.now())
}
