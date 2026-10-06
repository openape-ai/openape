export const definitionSchema = `
CREATE TABLE pod_definition_sources(
  definition_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('legacy','published')),
  source_pod_id TEXT REFERENCES pods(id),
  manifest TEXT CHECK(manifest IS NULL OR json_valid(manifest)),
  packages TEXT NOT NULL CHECK(json_valid(packages)),
  dependency_hash TEXT,
  FOREIGN KEY(source_pod_id,dependency_hash) REFERENCES dependency_sets(pod_id,hash),
  PRIMARY KEY(definition_id,version),
  FOREIGN KEY(definition_id,version) REFERENCES pod_definition_versions(definition_id,version)
);
CREATE TABLE definition_instance_requests(
  id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  pod_id TEXT NOT NULL UNIQUE REFERENCES pods(id),
  definition_id TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  owner_issuer TEXT NOT NULL,
  owner_subject TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','ready','failed')),
  error TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(definition_id,definition_version) REFERENCES pod_definition_versions(definition_id,version),
  FOREIGN KEY(owner_issuer,owner_subject) REFERENCES network_owners(issuer,subject)
);
CREATE TABLE definition_update_drafts(
  draft_id TEXT PRIMARY KEY REFERENCES script_drafts(id),
  pod_id TEXT NOT NULL REFERENCES pods(id),
  definition_id TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  expected_binding INTEGER NOT NULL,
  expected_active TEXT,
  FOREIGN KEY(definition_id,definition_version) REFERENCES pod_definition_versions(definition_id,version)
);`

export const definitionTables = ['pod_definition_sources', 'definition_instance_requests', 'definition_update_drafts']
