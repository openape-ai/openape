import type { Client } from '@libsql/client'
import { createHash } from 'node:crypto'

export interface DatabaseMigration {
  version: number
  name: string
  statements: string[]
}

export const databaseMigrations: DatabaseMigration[] = [
  { version: 1, name: 'Existing Git registry', statements: [
    `CREATE TABLE IF NOT EXISTS repos (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    default_branch TEXT NOT NULL DEFAULT 'main',
    created_at INTEGER NOT NULL
  )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_repos_owner_name ON repos(owner, name)`,
    `CREATE INDEX IF NOT EXISTS idx_repos_owner_email ON repos(owner_email)`,
    `CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
    `CREATE INDEX IF NOT EXISTS idx_webhooks_repo ON webhooks(repo_id)`,
    `CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL,
    repo_id TEXT NOT NULL,
    event TEXT NOT NULL,
    ref TEXT NOT NULL,
    status_code INTEGER,
    error TEXT,
    duration_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
    `CREATE INDEX IF NOT EXISTS idx_deliveries_repo ON webhook_deliveries(repo_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS commit_statuses (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    sha TEXT NOT NULL,
    context TEXT NOT NULL,
    state TEXT NOT NULL,
    description TEXT,
    target_url TEXT,
    log TEXT,
    created_at INTEGER NOT NULL
  )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_status_repo_sha_context ON commit_statuses(repo_id, sha, context)`,
    `CREATE TABLE IF NOT EXISTS pulls (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    source_ref TEXT NOT NULL,
    target_ref TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open',
    author_email TEXT NOT NULL,
    merge_sha TEXT,
    created_at INTEGER NOT NULL,
    merged_at INTEGER
  )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_pulls_repo_number ON pulls(repo_id, number)`,
    `CREATE INDEX IF NOT EXISTS idx_pulls_repo_state ON pulls(repo_id, state)`,
    `CREATE TABLE IF NOT EXISTS pull_comments (
    id TEXT PRIMARY KEY,
    pull_id TEXT NOT NULL,
    author_email TEXT NOT NULL,
    body TEXT NOT NULL,
    path TEXT,
    line INTEGER,
    created_at INTEGER NOT NULL
  )`,
    `CREATE INDEX IF NOT EXISTS idx_pull_comments_pull ON pull_comments(pull_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS grants (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    type TEXT,
    requester TEXT NOT NULL,
    target_host TEXT NOT NULL,
    audience TEXT NOT NULL,
    grant_type TEXT NOT NULL,
    request TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    decided_by TEXT,
    expires_at INTEGER,
    used_at INTEGER
  )`,
    `CREATE INDEX IF NOT EXISTS idx_grants_status ON grants(status)`,
    `CREATE INDEX IF NOT EXISTS idx_grants_requester ON grants(requester)`,
    `CREATE TABLE IF NOT EXISTS mirrors (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    url TEXT NOT NULL,
    username TEXT NOT NULL,
    token TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`,
    `CREATE INDEX IF NOT EXISTS idx_mirrors_repo ON mirrors(repo_id)`,
    `CREATE TABLE IF NOT EXISTS mirror_pushes (
    id TEXT PRIMARY KEY,
    mirror_id TEXT NOT NULL,
    repo_id TEXT NOT NULL,
    ref TEXT NOT NULL,
    sha TEXT NOT NULL,
    ok INTEGER NOT NULL,
    error TEXT,
    duration_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
    `CREATE INDEX IF NOT EXISTS idx_mirror_pushes_repo ON mirror_pushes(repo_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS mirror_ref_states (
    mirror_id TEXT NOT NULL, ref TEXT NOT NULL, source_sha TEXT, target_sha TEXT,
    last_successful_sha TEXT, checked_at INTEGER NOT NULL, synced_at INTEGER, error TEXT
  )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_mirror_state_ref ON mirror_ref_states(mirror_id, ref)`,
    `CREATE TABLE IF NOT EXISTS branch_protections (
    repo_id TEXT NOT NULL, branch TEXT NOT NULL, mirror_id TEXT NOT NULL,
    contexts TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL
  )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_protection_branch ON branch_protections(repo_id, branch)`,
    `CREATE TABLE IF NOT EXISTS protection_events (
    id TEXT PRIMARY KEY, repo_id TEXT NOT NULL, branch TEXT NOT NULL,
    actor TEXT NOT NULL, reason TEXT NOT NULL, configuration TEXT NOT NULL, created_at INTEGER NOT NULL
  )`,
  ] },
  { version: 2, name: 'Private issue storage', statements: [
    `ALTER TABLE repos ADD COLUMN reporting_enabled INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE repos ADD COLUMN issue_home_only INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE repos ADD COLUMN code_source_url TEXT`,
    `CREATE TABLE issue_counters (
    repo_id TEXT NOT NULL,
    next_number INTEGER NOT NULL,
    PRIMARY KEY(repo_id), CHECK(next_number > 0)
  )`,
    `CREATE TABLE issues (
    id TEXT NOT NULL,
    repo_id TEXT NOT NULL,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    state TEXT NOT NULL,
    product_key TEXT,
    assignee TEXT,
    author_subject TEXT,
    author_actor TEXT,
    version INTEGER NOT NULL,
    hidden INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    closed_at INTEGER,
    PRIMARY KEY(id), UNIQUE(repo_id, number), CHECK(number > 0), CHECK(version > 0), CHECK(state IN ('open','closed')), CHECK(hidden IN (0,1)), FOREIGN KEY(repo_id) REFERENCES repos(id)
  )`,
    `CREATE TABLE issue_comments (
    id TEXT NOT NULL,
    issue_id TEXT NOT NULL,
    body TEXT NOT NULL,
    author_subject TEXT,
    author_actor TEXT,
    version INTEGER NOT NULL,
    hidden INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER,
    PRIMARY KEY(id), FOREIGN KEY(issue_id) REFERENCES issues(id), CHECK(version > 0), CHECK(hidden IN (0,1))
  )`,
    `CREATE TABLE issue_labels (
    id TEXT NOT NULL,
    repo_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    description TEXT NOT NULL,
    archived INTEGER NOT NULL,
    version INTEGER NOT NULL,
    PRIMARY KEY(id), UNIQUE(repo_id, name), FOREIGN KEY(repo_id) REFERENCES repos(id)
  )`,
    `CREATE TABLE issue_label_links (
    issue_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    PRIMARY KEY(issue_id, label_id), FOREIGN KEY(issue_id) REFERENCES issues(id), FOREIGN KEY(label_id) REFERENCES issue_labels(id)
  )`,
    `CREATE TABLE issue_participants (
    issue_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(issue_id, subject), FOREIGN KEY(issue_id) REFERENCES issues(id)
  )`,
    `CREATE TABLE issue_products (
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    repo_id TEXT NOT NULL,
    routing_admin TEXT NOT NULL,
    approved_by TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    version INTEGER NOT NULL,
    PRIMARY KEY(key), FOREIGN KEY(repo_id) REFERENCES repos(id), CHECK(enabled IN (0,1))
  )`,
    `CREATE TABLE issue_pull_links (
    issue_id TEXT NOT NULL,
    pull_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    actor TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(issue_id, pull_id), FOREIGN KEY(issue_id) REFERENCES issues(id), FOREIGN KEY(pull_id) REFERENCES pulls(id)
  )`,
    `CREATE TABLE issue_events (
    id TEXT NOT NULL,
    issue_id TEXT NOT NULL,
    action TEXT NOT NULL,
    subject TEXT NOT NULL,
    actor TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    import_batch_id TEXT,
    PRIMARY KEY(id), FOREIGN KEY(issue_id) REFERENCES issues(id)
  )`,
    `CREATE TABLE issue_aliases (
    repo_id TEXT NOT NULL,
    number INTEGER NOT NULL,
    issue_id TEXT NOT NULL,
    PRIMARY KEY(repo_id, number), FOREIGN KEY(issue_id) REFERENCES issues(id)
  )`,
    `CREATE TABLE issue_legacy_references (
    source_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    issue_id TEXT NOT NULL,
    comment_id TEXT,
    PRIMARY KEY(source_key), FOREIGN KEY(issue_id) REFERENCES issues(id)
  )`,
    `CREATE TABLE issue_import_batches (
    id TEXT NOT NULL,
    source TEXT NOT NULL,
    manifest_hash TEXT NOT NULL,
    imported_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    PRIMARY KEY(id)
  )`,
    `CREATE TABLE issue_import_origins (
    source_key TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    provenance TEXT NOT NULL,
    PRIMARY KEY(source_key), FOREIGN KEY(batch_id) REFERENCES issue_import_batches(id)
  )`,
    `CREATE TABLE issue_attachments (
    id TEXT NOT NULL,
    issue_id TEXT NOT NULL,
    comment_id TEXT,
    source_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    provenance TEXT NOT NULL,
    PRIMARY KEY(id), FOREIGN KEY(issue_id) REFERENCES issues(id), CHECK(size >= 0)
  )`,
    `CREATE TABLE issue_write_requests (
    subject TEXT NOT NULL,
    actor TEXT NOT NULL,
    operation TEXT NOT NULL,
    request_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(subject, actor, operation, request_key)
  )`,
    `CREATE INDEX idx_issues_repo_updated ON issues(repo_id, updated_at, id)`,
    `CREATE INDEX idx_issues_state ON issues(state, updated_at, id)`,
    `CREATE INDEX idx_issues_product ON issues(product_key)`,
    `CREATE INDEX idx_issues_assignee ON issues(assignee)`,
    `CREATE INDEX idx_issue_participant_subject ON issue_participants(subject, issue_id)`,
    `CREATE INDEX idx_issue_comments_order ON issue_comments(issue_id, created_at, id)`,
    `CREATE INDEX idx_issue_events_order ON issue_events(issue_id, created_at, id)`,
    `CREATE INDEX idx_issue_links_label ON issue_label_links(label_id, issue_id)`,
  ] },
]

export async function migrateDatabase(client: Client, migrations = databaseMigrations): Promise<void> {
  for (const migration of migrations) {
    const checksum = createHash('sha256').update(JSON.stringify(migration.statements)).digest('hex')
    const tx = await client.transaction('write')
    try {
      await tx.execute('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)')
      const applied = await tx.execute({ sql: 'SELECT checksum FROM schema_migrations WHERE version = ?', args: [migration.version] })
      if (applied.rows.length) {
        if (applied.rows[0]!.checksum !== checksum) throw new Error(`Migration ${migration.version} checksum mismatch`)
      }
      else {
        const latest = await tx.execute('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
        if (Number(latest.rows[0]!.version) + 1 !== migration.version) throw new Error('Database migrations must be consecutive')
        for (const statement of migration.statements) await tx.execute(statement)
        await tx.execute({ sql: 'INSERT INTO schema_migrations VALUES (?, ?, ?, ?)', args: [migration.version, migration.name, checksum, Date.now()] })
      }
      await tx.commit()
    }
    catch (error) {
      await tx.rollback()
      throw error
    }
    finally {
      tx.close()
    }
  }
}
