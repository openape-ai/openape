import type { DatabaseSync } from 'node:sqlite'

export function removeWorkflowSchema(database: DatabaseSync): void {
  for (const table of database.prepare('SELECT name FROM sqlite_schema WHERE type=\'table\' AND (name LIKE \'chat_%\' OR name IN (\'control_changes\',\'control_runs\')) ORDER BY rowid DESC').all()) database.exec(`DROP TABLE ${table.name}`)
  for (const table of database.prepare('SELECT name FROM sqlite_schema WHERE type=\'table\' AND name LIKE \'workflow%\' ORDER BY rowid DESC').all()) database.exec(`DROP TABLE ${table.name}`)
}
