import { networkControlIndexes, networkControlTables } from '../../src/worker/storage/network-control-schema'
import { networkTables } from '../../src/worker/storage/network-schema'
import type { DatabaseSync } from 'node:sqlite'

export function removeNetworkControls(database: DatabaseSync): void {
  for (const index of networkControlIndexes) database.exec(`DROP INDEX ${index}`)
  for (const table of [...networkControlTables].reverse()) database.exec(`DROP TABLE ${table}`)
}

export function removeNetworkSchema(database: DatabaseSync): void {
  removeNetworkControls(database)
  for (const table of [...networkTables].reverse()) database.exec(`DROP TABLE ${table}`)
}

export function removeGraphSchema(database: DatabaseSync): void {
  removeNetworkSchema(database)
  database.exec('DROP INDEX graph_gate_batches_open; DROP TABLE graph_gate_batches; DROP TABLE graph_item_events; DROP TABLE graph_deliveries; DROP TABLE graph_items; DROP TABLE workflow_values; DROP TABLE workflow_gates; DROP TABLE workflow_channels; ALTER TABLE workflows DROP COLUMN mode; ALTER TABLE workflows DROP COLUMN group_id;')
}

export function removeRemoteSchema(database: DatabaseSync): void {
  removeGraphSchema(database)
  database.exec('DROP TABLE run_deletion_jobs; DROP INDEX runs_retention; DROP INDEX accepted_events_run; DROP INDEX workflow_nodes_run;')
  for (const table of database.prepare('SELECT name FROM sqlite_schema WHERE type=\'table\' AND name LIKE \'remote_%\' ORDER BY rowid DESC').all()) database.exec(`DROP TABLE ${table.name}`)
}

export function removeWorkflowSchema(database: DatabaseSync): void {
  removeRemoteSchema(database)
  for (const table of database.prepare('SELECT name FROM sqlite_schema WHERE type=\'table\' AND (name LIKE \'chat_%\' OR name IN (\'control_changes\',\'control_runs\')) ORDER BY rowid DESC').all()) database.exec(`DROP TABLE ${table.name}`)
  for (const table of database.prepare('SELECT name FROM sqlite_schema WHERE type=\'table\' AND name LIKE \'workflow%\' ORDER BY rowid DESC').all()) database.exec(`DROP TABLE ${table.name}`)
}
