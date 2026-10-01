export const networkDataSchema = `
CREATE TABLE network_maintenance_status(
  network_id TEXT NOT NULL REFERENCES networks(id),
  operation TEXT NOT NULL CHECK(operation IN ('traces','artifacts')),
  body TEXT CHECK(body IS NULL OR json_valid(body)),
  failure_count INTEGER NOT NULL CHECK(failure_count>0),
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  PRIMARY KEY(network_id,operation)
);
CREATE TABLE network_data_staging(
  run_id TEXT NOT NULL REFERENCES network_invocations(run_id),
  collection_id TEXT NOT NULL REFERENCES data_collections(id),
  record_key TEXT NOT NULL,
  base_revision INTEGER NOT NULL CHECK(base_revision>=0),
  revision INTEGER NOT NULL CHECK(revision>base_revision),
  schema_version INTEGER NOT NULL,
  body TEXT CHECK(body IS NULL OR json_valid(body)),
  tombstone INTEGER NOT NULL CHECK(tombstone IN (0,1)),
  artifact_refs TEXT NOT NULL CHECK(json_valid(artifact_refs)),
  PRIMARY KEY(run_id,collection_id,record_key,revision)
);
CREATE TABLE data_record_provenance(
  collection_id TEXT NOT NULL,
  record_key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  pod_id TEXT NOT NULL REFERENCES pods(id),
  source_refs TEXT NOT NULL CHECK(json_valid(source_refs)),
  verification TEXT NOT NULL DEFAULT 'proposed' CHECK(verification IN ('proposed','owner_verified')),
  PRIMARY KEY(collection_id,record_key,revision),
  FOREIGN KEY(collection_id,record_key,revision) REFERENCES data_record_revisions(collection_id,record_key,revision)
);
CREATE TABLE data_index_values(
  collection_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  index_name TEXT NOT NULL,
  record_key TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_text TEXT,
  value_number REAL,
  PRIMARY KEY(collection_id,schema_version,index_name,record_key),
  FOREIGN KEY(collection_id,record_key) REFERENCES data_records(collection_id,record_key)
);
CREATE INDEX data_index_lookup ON data_index_values(collection_id,schema_version,index_name,value_type,value_text,value_number,record_key);
CREATE TABLE network_artifact_staging(
  run_id TEXT NOT NULL REFERENCES network_invocations(run_id),
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL REFERENCES artifact_scopes(id),
  content_hash TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size BETWEEN 0 AND 131072),
  media_type TEXT NOT NULL,
  storage_ref TEXT NOT NULL
);
CREATE TABLE definition_config(
  definition_id TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('public','secret-reference')),
  value TEXT NOT NULL CHECK(json_valid(value)),
  PRIMARY KEY(definition_id,definition_version,name),
  FOREIGN KEY(definition_id,definition_version) REFERENCES pod_definition_versions(definition_id,version)
);
CREATE TABLE composition_config(
  network_id TEXT NOT NULL REFERENCES networks(id),
  name TEXT NOT NULL,
  value TEXT NOT NULL CHECK(json_valid(value)),
  PRIMARY KEY(network_id,name)
);
CREATE TABLE instance_config(
  pod_id TEXT NOT NULL REFERENCES pods(id),
  name TEXT NOT NULL,
  value TEXT NOT NULL CHECK(json_valid(value)),
  PRIMARY KEY(pod_id,name)
);`

export const networkDataTables = ['network_maintenance_status', 'network_data_staging', 'data_record_provenance', 'data_index_values', 'network_artifact_staging', 'definition_config', 'composition_config', 'instance_config']
