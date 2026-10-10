import type { DatabaseSync } from 'node:sqlite'

/** Pod grants (MAY) recorded apart from the sandbox resources (CAN); see worker/resources/grants.ts. */
export const grantLedgerSchema = `
CREATE TABLE IF NOT EXISTS pod_grants(id TEXT PRIMARY KEY, pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE, issuer TEXT NOT NULL, subject TEXT NOT NULL, cli_id TEXT NOT NULL, details TEXT NOT NULL, display TEXT NOT NULL, grant_type TEXT NOT NULL CHECK(grant_type IN ('once','timed','always')), state TEXT NOT NULL CHECK(state IN ('pending','approved','denied','revoked','expired','used')), network_id TEXT, network_revision INTEGER, approved_in_session INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS pod_grants_coverage ON pod_grants(pod_id, cli_id, state);
CREATE INDEX IF NOT EXISTS pod_grants_network ON pod_grants(network_id, state);
CREATE TABLE IF NOT EXISTS pod_sandbox(pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE, source TEXT NOT NULL, network_revision INTEGER, level TEXT NOT NULL CHECK(level IN ('isolated','owner')), PRIMARY KEY(pod_id, source));
CREATE TABLE IF NOT EXISTS network_sandbox_resources(network_id TEXT NOT NULL, network_revision INTEGER NOT NULL, pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE, resource_id TEXT NOT NULL, PRIMARY KEY(network_id, resource_id));
`

/**
 * Application and HTTP resources stored their grant inside the sandbox assignment until schema 43. The grant stays
 * at the IdP: the next call requests the same details as the Pod identity, and the IdP returns the existing approved
 * continuing grant instead of asking again. Only the copy inside the sandbox resource is removed.
 */
export function separateStoredGrants(database: DatabaseSync): number {
  const rows = database.prepare('SELECT id,configuration FROM resources WHERE json_extract(configuration,\'$.type\') IN (\'program\',\'http\')').all()
  const update = database.prepare('UPDATE resources SET configuration=? WHERE id=?')
  for (const row of rows) {
    const { grants: _grants, authority: _authority, ...configuration } = JSON.parse(String(row.configuration)) as Record<string, unknown>
    update.run(JSON.stringify(configuration), row.id!)
  }
  return rows.length
}
