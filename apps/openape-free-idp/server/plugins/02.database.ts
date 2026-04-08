import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'

export default defineNitroPlugin(async () => {
  if (process.env.OPENAPE_E2E === '1') return

  const db = useDb()

  // --- Grants ---
  await db.run(sql`CREATE TABLE IF NOT EXISTS grants (
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
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_grants_status ON grants(status)`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_grants_requester ON grants(requester)`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_grants_created_at ON grants(created_at)`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_grants_type ON grants(type)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS grant_challenges (
    challenge TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`)

  // --- WebAuthn ---
  await db.run(sql`CREATE TABLE IF NOT EXISTS credentials (
    credential_id TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL,
    transports TEXT,
    device_type TEXT NOT NULL,
    backed_up INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    name TEXT
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_credentials_user_email ON credentials(user_email)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS webauthn_challenges (
    token TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    user_email TEXT,
    type TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS registration_urls (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    consumed INTEGER NOT NULL DEFAULT 0
  )`)

  // --- SSH Keys ---
  await db.run(sql`CREATE TABLE IF NOT EXISTS ssh_keys (
    key_id TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    public_key TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_ssh_keys_user_email ON ssh_keys(user_email)`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_ssh_keys_public_key ON ssh_keys(public_key)`)

  // --- Migration: unstorage → Drizzle tables ---
  await migrateFromUnstorage(db)
})

async function migrateFromUnstorage(db: ReturnType<typeof useDb>) {
  // Check if unstorage table exists
  const tables = await db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type='table' AND name='unstorage'`)
  if (tables.length === 0) return

  // Migrate credentials
  const credRows = await db.all<{ key: string, value: string }>(sql`SELECT key, value FROM unstorage WHERE key LIKE 'credentials:%'`)
  for (const row of credRows) {
    const c = JSON.parse(row.value)
    await db.run(sql`INSERT OR IGNORE INTO credentials (credential_id, user_email, public_key, counter, transports, device_type, backed_up, created_at, name)
      VALUES (${c.credentialId}, ${c.userEmail}, ${c.publicKey}, ${c.counter}, ${JSON.stringify(c.transports)}, ${c.deviceType}, ${c.backedUp ? 1 : 0}, ${c.createdAt}, ${c.name ?? null})`)
  }

  // Migrate registration URLs
  const regRows = await db.all<{ key: string, value: string }>(sql`SELECT key, value FROM unstorage WHERE key LIKE 'registration-urls:%'`)
  for (const row of regRows) {
    const r = JSON.parse(row.value)
    await db.run(sql`INSERT OR IGNORE INTO registration_urls (token, email, name, created_at, expires_at, created_by, consumed)
      VALUES (${r.token}, ${r.email}, ${r.name}, ${r.createdAt}, ${r.expiresAt}, ${r.createdBy}, ${r.consumed ? 1 : 0})`)
  }

  // Migrate agent public keys → ssh_keys
  const agentRows = await db.all<{ email: string, name: string, public_key: string | null }>(
    sql`SELECT email, name, public_key FROM users WHERE owner IS NOT NULL AND public_key IS NOT NULL`,
  )
  for (const agent of agentRows) {
    if (!agent.public_key) continue
    const parts = agent.public_key.trim().split(/\s+/)
    const keyData = parts[1]
    if (!keyData) continue
    const keyId = createHash('sha256').update(Buffer.from(keyData, 'base64')).digest('hex')
    await db.run(sql`INSERT OR IGNORE INTO ssh_keys (key_id, user_email, public_key, name, created_at)
      VALUES (${keyId}, ${agent.email}, ${agent.public_key.trim()}, ${agent.name}, ${Math.floor(Date.now() / 1000)})`)
  }

  // Clean up migrated unstorage entries
  await db.run(sql`DELETE FROM unstorage WHERE key LIKE 'credentials:%'`)
  await db.run(sql`DELETE FROM unstorage WHERE key LIKE 'registration-urls:%'`)
  await db.run(sql`DELETE FROM unstorage WHERE key LIKE 'user-credentials:%'`)
  await db.run(sql`DELETE FROM unstorage WHERE key LIKE 'webauthn-challenges:%'`)
  // Keep agents/users/grants/keys in unstorage as backup (already in Drizzle tables)
}
