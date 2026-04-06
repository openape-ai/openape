import { sql } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import type * as schema from './schema'

/**
 * Creates all tables if they don't exist.
 * Simple approach for v1 — no migration tooling needed.
 */
export async function ensureTables(db: LibSQLDatabase<typeof schema>) {
  await db.run(sql`CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner TEXT,
    approver TEXT,
    type TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_users_owner ON users(owner)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS ssh_keys (
    key_id TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    public_key TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_ssh_keys_user_email ON ssh_keys(user_email)`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_ssh_keys_public_key ON ssh_keys(public_key)`)

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

  await db.run(sql`CREATE TABLE IF NOT EXISTS codes (
    code TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    user_id TEXT NOT NULL,
    nonce TEXT,
    expires_at INTEGER NOT NULL,
    extra_data TEXT
  )`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS signing_keys (
    kid TEXT PRIMARY KEY,
    private_key_jwk TEXT NOT NULL,
    public_key_jwk TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS jtis (
    jti TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  )`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS refresh_token_families (
    family_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    current_token_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_refresh_families_user_id ON refresh_token_families(user_id)`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_refresh_families_client_id ON refresh_token_families(client_id)`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS registration_urls (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    consumed INTEGER NOT NULL DEFAULT 0
  )`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_hash TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  )`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id ON refresh_tokens(family_id)`)
}
