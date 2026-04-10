import { sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'

export default defineNitroPlugin(async () => {
  if (process.env.OPENAPE_E2E === '1') return

  try {
    const db = useDb()

    await db.run(sql`CREATE TABLE IF NOT EXISTS grants (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, type TEXT,
      requester TEXT NOT NULL, target_host TEXT NOT NULL, audience TEXT NOT NULL,
      grant_type TEXT NOT NULL, request TEXT NOT NULL, created_at INTEGER NOT NULL,
      decided_at INTEGER, decided_by TEXT, expires_at INTEGER, used_at INTEGER
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_grants_status ON grants(status)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_grants_requester ON grants(requester)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_grants_created_at ON grants(created_at)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_grants_type ON grants(type)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS grant_challenges (
      challenge TEXT PRIMARY KEY, agent_id TEXT NOT NULL, expires_at INTEGER NOT NULL
    )`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS credentials (
      credential_id TEXT PRIMARY KEY, user_email TEXT NOT NULL, public_key TEXT NOT NULL,
      counter INTEGER NOT NULL, transports TEXT, device_type TEXT NOT NULL,
      backed_up INTEGER NOT NULL, created_at INTEGER NOT NULL, name TEXT
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_credentials_user_email ON credentials(user_email)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS webauthn_challenges (
      token TEXT PRIMARY KEY, challenge TEXT NOT NULL, user_email TEXT,
      type TEXT NOT NULL, expires_at INTEGER NOT NULL
    )`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS registration_urls (
      token TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      created_by TEXT NOT NULL, consumed INTEGER NOT NULL DEFAULT 0
    )`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS ssh_keys (
      key_id TEXT PRIMARY KEY, user_email TEXT NOT NULL, public_key TEXT NOT NULL,
      name TEXT NOT NULL, created_at INTEGER NOT NULL
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_ssh_keys_user_email ON ssh_keys(user_email)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_ssh_keys_public_key ON ssh_keys(public_key)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS codes (
      code TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
      code_challenge TEXT NOT NULL, user_id TEXT NOT NULL, nonce TEXT,
      expires_at INTEGER NOT NULL, extra_data TEXT
    )`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS refresh_token_families (
      family_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, client_id TEXT NOT NULL,
      current_token_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_refresh_families_user_id ON refresh_token_families(user_id)`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_refresh_families_client_id ON refresh_token_families(client_id)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS refresh_tokens (
      token_hash TEXT PRIMARY KEY, family_id TEXT NOT NULL, user_id TEXT NOT NULL,
      client_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    )`)
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id ON refresh_tokens(family_id)`)

    await db.run(sql`CREATE TABLE IF NOT EXISTS jtis (
      jti TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
    )`)
  }
  catch (err) {
    console.error('[database] Table creation failed (tables may already exist):', err)
  }
})
