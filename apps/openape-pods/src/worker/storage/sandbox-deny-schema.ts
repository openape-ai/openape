/**
 * The owner's sandbox denylist per Pod and source (`pod` or `network:<id>` at the revision that declared it), as a
 * JSON array of paths; see worker/resources/grants.ts. Schema 44.
 */
export const sandboxDenySchema = `
CREATE TABLE IF NOT EXISTS pod_sandbox_deny(pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE, source TEXT NOT NULL, network_revision INTEGER, paths TEXT NOT NULL, PRIMARY KEY(pod_id, source));
`
