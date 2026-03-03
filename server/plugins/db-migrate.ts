import { sql } from 'drizzle-orm'
import { defineNitroPlugin } from '#imports'
import { useDb } from '../utils/db'

export default defineNitroPlugin(async () => {
  const db = useDb()

  await db.run(sql`CREATE TABLE IF NOT EXISTS magic_link_tokens (
    token TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS auth_codes (
    code TEXT PRIMARY KEY NOT NULL,
    sp_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    user_id TEXT NOT NULL,
    nonce TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS signing_keys (
    kid TEXT PRIMARY KEY NOT NULL,
    private_key_jwk TEXT NOT NULL,
    public_key_jwk TEXT NOT NULL,
    is_active INTEGER DEFAULT 1 NOT NULL,
    created_at INTEGER NOT NULL
  )`)

  await db.run(sql`CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY NOT NULL,
    count INTEGER DEFAULT 0 NOT NULL,
    window_start INTEGER NOT NULL
  )`)
})
