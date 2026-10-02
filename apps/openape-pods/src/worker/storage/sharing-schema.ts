export const sharingSchema = `
CREATE TABLE portable_imports(
  id TEXT PRIMARY KEY,
  owner_issuer TEXT NOT NULL,
  owner_subject TEXT NOT NULL,
  transfer_hash TEXT NOT NULL CHECK(length(transfer_hash)=64),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  archive_hash TEXT CHECK(archive_hash IS NULL OR archive_hash=transfer_hash),
  state TEXT NOT NULL CHECK(state IN ('staged','committed','completed','cancelled')),
  revision INTEGER NOT NULL,
  manifest TEXT NOT NULL CHECK(json_valid(manifest)),
  setup TEXT NOT NULL CHECK(json_valid(setup)),
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(owner_issuer,owner_subject) REFERENCES network_owners(issuer,subject)
);
CREATE TABLE portable_import_pods(
  import_id TEXT NOT NULL REFERENCES portable_imports(id),
  key TEXT NOT NULL,
  pod_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY(import_id,key)
);`

export const sharingTables = ['portable_imports', 'portable_import_pods']
